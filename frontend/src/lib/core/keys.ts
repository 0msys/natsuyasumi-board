// 項目キーの採番と剥がし。backend/app/admin/definition_store.py の非 DB 部の移植。
//
// key は記録の照合キー。利用者には見せず自動で振る（ラベルを改名してもキーは変わらない
// ＝改名で履歴が切れない）。ラベルからキーを導出しないのは、そうすると「改名したら
// キーも変えたくなる」誘惑が生まれるため。
import { shiftYear, type DayString } from './dates';
import { migrateDoc } from './definition';

/** 区画ごとのキー接頭辞（choice の選択肢はグループとドット連結で保存される）。 */
export const KEY_PREFIXES = {
	habits: 'h_',
	daily_homework: 'dh_',
	special_challenges: 'sc_',
	one_shot_homework: 'os_',
	school_start_items: 'ss_',
	choice_homework: 'cg_',
	choice_option: 'o_',
	meta: 'm_',
	meta_option: 'mo_',
	rewards: 'r_'
} as const;

const ALPHABET36 = '0123456789abcdefghijklmnopqrstuvwxyz';

type Doc = Record<string, unknown>;

const isMap = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 区画を項目の配列として取り出す（配列でなければ空）。
 *
 *  採番は検証より前に走るので、ここで型を確かめないと壊れた JSON の取り込みが
 *  「定義が壊れています」ではなく素の例外になる。壊れているかの判定はパーサに任せ、
 *  ここは「採番できる形のものだけ触る」に徹する。 */
const items = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);

/** ランダムなキー1本。crypto を使うのは値の質より「重複しにくさ」のため。 */
function randKey(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	let out = prefix;
	for (const b of bytes) out += ALPHABET36[b % 36];
	return out;
}

function freshKey(prefix: string, used: Set<string>): string {
	for (;;) {
		const key = randKey(prefix);
		if (!used.has(key)) {
			used.add(key);
			return key;
		}
	}
}

/** key を持ちうる項目を全区画から順に取り出す（採番・キー剥がしで共用）。 */
function* walkKeyed(doc: Doc): Generator<Doc> {
	const sections = [
		'habits',
		'daily_homework',
		'special_challenges',
		'one_shot_homework',
		'school_start_items',
		'rewards'
	];
	for (const section of sections) {
		for (const item of items(doc[section])) {
			if (!isMap(item)) continue;
			yield item;
			for (const field of items(item.meta)) {
				if (!isMap(field)) continue;
				yield field;
				for (const opt of items(field.options)) if (isMap(opt)) yield opt;
			}
		}
	}
	for (const group of items(doc.choice_homework)) {
		if (!isMap(group)) continue;
		yield group;
		for (const opt of items(group.options)) if (isMap(opt)) yield opt;
	}
}

/** ドキュメント内の既存キーを全区画から集める（採番の衝突回避用・空間は分けない）。 */
export function collectKeys(doc: Doc): Set<string> {
	const keys = new Set<string>();
	for (const item of walkKeyed(doc)) {
		if (item.key) keys.add(String(item.key));
	}
	return keys;
}

/** key が空（欠落・null・空文字）の項目にキーを振る（doc を書き換えて返す）。
 *
 *  採番の前に旧形式（practice_homework）を畳む＝取り込んだ古い JSON も、この先は
 *  daily_homework 1本として採番・保存される。 */
export function assignKeys(doc: Doc): Doc {
	migrateDoc(doc);
	const used = collectKeys(doc);
	const fill = (raw: unknown, prefix: string) => {
		for (const item of items(raw)) {
			if (isMap(item) && !item.key) item.key = freshKey(prefix, used);
		}
	};

	fill(doc.habits, KEY_PREFIXES.habits);
	fill(doc.daily_homework, KEY_PREFIXES.daily_homework);
	fill(doc.special_challenges, KEY_PREFIXES.special_challenges);
	fill(doc.one_shot_homework, KEY_PREFIXES.one_shot_homework);
	fill(doc.school_start_items, KEY_PREFIXES.school_start_items);
	fill(doc.rewards, KEY_PREFIXES.rewards);
	for (const item of items(doc.daily_homework)) {
		if (isMap(item)) {
			fill(item.meta, KEY_PREFIXES.meta);
			// choice 型メモの選択肢キー（保存値になる）も採番対象
			for (const field of items(item.meta)) {
				if (isMap(field)) fill(field.options, KEY_PREFIXES.meta_option);
			}
		}
	}
	for (const group of items(doc.choice_homework)) {
		if (!isMap(group)) continue;
		if (!group.key) group.key = freshKey(KEY_PREFIXES.choice_homework, used);
		fill(group.options, KEY_PREFIXES.choice_option);
	}
	return doc;
}

/**
 * 全項目の key を落とす（doc を書き換えて返す）。
 *
 * 次の assignKeys で新しいキーが振られる＝記録のキー空間が前の定義と分かれる。
 * **年をまたいで定義をコピーするときは必ず通す。** ここを飛ばすと、去年の
 * 「絵日記できた」「読書5冊」が今年も済み扱いのまま出てくる（フラグは年を持たないため）。
 */
export function stripKeys(doc: Doc): Doc {
	for (const item of walkKeyed(doc)) delete item.key;
	return doc;
}

/** 'YYYY-MM-DD' を1年ずらす（2/29 だけは 2/28 に丸める）。 */
export const shiftIsoYear = (iso: DayString, delta: number): DayString => shiftYear(iso, delta);

/** 来年ぶんのひな型を作る（doc を書き換えて返す。保存はしない）。
 *
 *  引き継ぐのは項目の中身・タイマーの上限・声・「はじめとおわりだけ」の日数。
 *  引き継がないのは記録（キーを振り直す）とおでかけの予定（去年の帰省日程は今年と関係ない）。 */
export function shiftDocToNextYear(doc: Doc, nextGrade: string, nextYear: number): Doc {
	doc.grade = nextGrade;
	doc.year = nextYear;

	const period = doc.period;
	if (isMap(period)) {
		for (const key of ['start', 'end', 'first_day_of_school']) {
			if (typeof period[key] === 'string') period[key] = shiftIsoYear(period[key], 1);
		}
	}
	for (const item of items(doc.habits)) {
		if (!isMap(item)) continue;
		for (const key of ['window_start', 'window_end']) {
			if (typeof item[key] === 'string') item[key] = shiftIsoYear(item[key], 1);
		}
	}
	for (const item of items(doc.school_start_items)) {
		if (isMap(item) && typeof item.due === 'string') item.due = shiftIsoYear(item.due, 1);
	}
	doc.away = [];
	stripKeys(doc);
	return doc;
}

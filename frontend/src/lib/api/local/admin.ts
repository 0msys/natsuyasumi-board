// 管理画面の api（lite 版）。backend/app/admin/definition_store.py の移植。
//
// 保存は「キー採番 → 検証 → 楽観ロック → 履歴に退避」を、書き込みの直列化のなかで
// まとめて行う（バックエンドが1トランザクションでやっていたのと同じ範囲）。
import { todayJst } from '$lib/core/clock';
import {
	SummerDefinitionError,
	dailyItemKeys,
	flagItemKeys,
	migrateDoc,
	parseDefinition,
	parseGrade,
	type SummerDefinition
} from '$lib/core/definition';
import { GRADE_KANJI_SOURCE } from '$lib/core/generated/kanjiTable';
import { assignKeys, collectKeys, shiftDocToNextYear, stripKeys } from '$lib/core/keys';
import { TEMPLATES, type Period } from '$lib/core/template';
import { validateDocument } from '$lib/core/validate';
import { mutate, read } from '$lib/store/db';
import {
	HISTORY_KEEP,
	containsSeparator,
	defKey,
	joinKey,
	splitKey,
	type Db,
	type DefinitionRow
} from '$lib/store/model';
import { ApiError } from '../contract';
import { nowEpochSec, rowFor, yearsOf } from './shared';
import { listChildren } from './summer';

type Doc = Record<string, unknown>;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 編集用の1件を返す。
 *
 *  doc は**必ず写しを返す**。管理画面はこの doc を直接書き換える作りなので、
 *  保存中の実体をそのまま渡すと、保存を押す前の編集が生きているデータに入ってしまう。
 *  そうなると:
 *    - 検証の比較相手（前の定義）が編集後の姿になり、「記録のある項目を消した」
 *      「期間の途中で足した」の警告が鳴らなくなる
 *    - 保存せずに離れても編集が残り、開き直すと出てくる
 *    - 子どもの画面が、保存していない設定を先に映す
 *  docker 版は HTTP の JSON を挟むので毎回別物になる。その境目をこちらでも作る。 */
const entryOf = (db: Db, row: DefinitionRow) => ({
	child: row.child,
	year: row.year,
	years: yearsOf(db, row.child),
	revision: row.revision,
	updated_at: row.updated_at,
	// 旧形式で保存されたままの doc も、編集画面には新形式（daily_homework 1本）で渡す。
	// 保存の実体は次の保存まで旧形式のままだが、revision は据え置きなので楽観ロックは壊れない。
	doc: migrateDoc(clone(row.doc))
});

/** 定義を検証して受け取る（壊れていれば 422）。 */
function parseOr422(doc: Doc, source: string) {
	try {
		const definition = parseDefinition(doc, source);
		assertKeyable(definition);
		return definition;
	} catch (e) {
		if (e instanceof SummerDefinitionError) throw new ApiError(422, e.message);
		throw e;
	}
}

/** 記録のキーに載せられる文字だけでできているか。
 *
 *  記録は「名前＋日付＋項目キー」を区切り文字でつないだキーで持つ。名前や項目キーに
 *  区切りそのものが入ると、読むときの切り分けがずれて、書けたはずの記録が別人の
 *  ものに見えて出てこなくなる。**保存は成功するので、消えたことに気づけない。**
 *
 *  ふつうの操作では入らない（画面から打てる文字ではない）。入りうるのは、手で書いた
 *  JSON を取り込む道だけ。バックエンドは SQLite の列に素直に入るので気にしなくてよく、
 *  これは lite の持ちかたに固有の制約——だから core ではなくここで断る。 */
function assertKeyable(definition: SummerDefinition): void {
	const values = [definition.child, ...dailyItemKeys(definition), ...flagItemKeys(definition)];
	if (values.some(containsSeparator)) {
		throw new ApiError(
			422,
			'名前や項目のキーに、この版では使えない文字が入っています（記録を保存できません）'
		);
	}
}

/** 同じ子の、**いま登録されている**別の年が使っている項目キー。
 *
 *  旧形式のまま保存されている定義（practice_homework）は、畳んでから集める。
 *  区画の名前が違うだけでキーは生きているので、そのまま数えると見落とす。 */
function keysOfOtherYears(db: Db, child: string, year: number): Set<string> {
	const keys = new Set<string>();
	for (const row of Object.values(db.definitions)) {
		if (row.child !== child || row.year === year) continue;
		for (const key of collectKeys(migrateDoc(clone(row.doc)))) keys.add(key);
	}
	return keys;
}

/**
 * 新しい定義を作る（ウィザード・インポート共用）。同じ子の同じ年が居れば 409。
 *
 * 年が違えば同じ子でも作れる（来年ぶん）。ただし記録側のフラグは年を持たないので、
 * **別の年の定義は必ず別のキー空間**でなければならない（去年の「絵日記できた」が
 * 今年も済み扱いになる）。ウィザードと来年コピーはキーを持たない doc を渡すので
 * 採番で新しくなる。エクスポート JSON の取り込みだけはキーを持ったまま来るので、
 * ここで**生きている別の年とキーがぶつかるなら**振り直す。
 */
export function createDefinition(db: Db, incoming: Doc) {
	const doc = clone(incoming);
	assignKeys(doc);
	let definition = parseOr422(doc, String(doc.child ?? '定義'));

	if (db.definitions[defKey(definition.child, definition.year)]) {
		throw new ApiError(
			409,
			`「${definition.child}」の${definition.year}年ぶんはもう登録されています`
		);
	}
	// 「別の年が居る」だけで振り直してはいけない。年ごとの削除は記録を残す
	// （画面も「記録は消えません」と約束している）ので、消した年を書き出しておいた
	// JSON から登録しなおす道も、ここを通る。ぶつかってもいないのに振り直すと、
	// のこしておいた記録は古いキーのまま孤児になり、二度と結びつかない。
	// ぶつかるとき——まだ登録されている年からコピーした doc——だけ分ければ足りる。
	const taken = keysOfOtherYears(db, definition.child, definition.year);
	const collides = [...collectKeys(doc)].some((key) => taken.has(key));
	if (collides) {
		stripKeys(doc);
		assignKeys(doc);
		definition = parseOr422(doc, definition.child);
	}

	const row: DefinitionRow = {
		child: definition.child,
		year: definition.year,
		doc,
		revision: 1,
		updated_at: nowEpochSec()
	};
	db.definitions[defKey(row.child, row.year)] = row;
	return entryOf(db, row);
}

export function saveDocument(
	db: Db,
	child: string,
	incoming: Doc,
	expectedRevision: number,
	year: number | undefined
) {
	const doc = clone(incoming);
	assignKeys(doc);
	const definition = parseOr422(doc, child);
	if (definition.child !== child) {
		throw new ApiError(400, 'child は変更できません（名前の変更は rename を使ってください）');
	}
	const row = rowFor(db, child, year, todayJst());
	if (!row) throw new ApiError(404, `「${child}」の定義がありません`);
	if (definition.year !== row.year) throw new ApiError(400, 'year は変更できません');
	if (row.revision !== expectedRevision) {
		throw new ApiError(409, 'ほかの画面で変更されています。読み直してから保存してください');
	}

	const key = defKey(child, row.year);
	const history = (db.definition_history[key] ??= []);
	history.unshift({ revision: row.revision, doc: row.doc, saved_at: nowEpochSec() });
	history.length = Math.min(history.length, HISTORY_KEEP);

	row.doc = doc;
	row.revision += 1;
	row.updated_at = nowEpochSec();
	return entryOf(db, row);
}

export function createNextYear(db: Db, child: string) {
	const years = yearsOf(db, child);
	if (!years.length) throw new ApiError(404, `「${child}」の定義がありません`);
	const latest = db.definitions[defKey(child, years[years.length - 1])];
	const doc = clone(latest.doc);
	try {
		parseDefinition(doc, `${child}（${latest.year}年）`);
	} catch (e) {
		if (e instanceof SummerDefinitionError) {
			throw new ApiError(422, `元の定義が壊れているのでコピーできません: ${e.message}`);
		}
		throw e;
	}
	const [, level] = parseGrade(doc.grade, child);
	if (level >= 6) {
		throw new ApiError(
			400,
			'小6の次の学年はありません（このアプリは小学生のなつやすみ用です）'
		);
	}
	shiftDocToNextYear(doc, `小${level + 1}`, latest.year + 1);
	return createDefinition(db, doc);
}

export function renameChild(db: Db, child: string, next: string) {
	const trimmed = String(next ?? '').trim();
	if (!trimmed) throw new ApiError(400, '新しい名前を入れてください');
	if (containsSeparator(trimmed)) {
		throw new ApiError(400, '名前に、この版では使えない文字が入っています');
	}
	if (trimmed === child) return { ok: true, child: trimmed };
	if (Object.values(db.definitions).some((r) => r.child === trimmed)) {
		throw new ApiError(409, `「${trimmed}」はもう居ます`);
	}
	if (!Object.values(db.definitions).some((r) => r.child === child)) {
		throw new ApiError(404, `「${child}」の定義がありません`);
	}
	// 定義を消しても記録は残す（登録し直せば戻る）ので、消したあとの名前には
	// まだ記録がぶら下がっている。そこへ別の子を改名すると、同じ日・同じ項目キーの
	// 行が黙って上書きされて、戻せるはずだった記録が消える。
	// 項目キーは定義ごとに振り直されるので普通はぶつからないが、同じ設定 JSON を
	// 兄弟で使い回した場合（README が勧めている使いかた）は一致する。
	// バックエンドは保存側の一意制約に弾かれてエラーになる＝データは失われない。
	// こちらは素のオブジェクトなので、自分で断る。
	const retained = [db.daily_checks, db.flags, db.media_timer, db.definition_history].some(
		(table) => Object.keys(table).some((key) => splitKey(key)[0] === trimmed)
	);
	if (retained) {
		throw new ApiError(
			409,
			`「${trimmed}」の記録がのこっています（まえに消した子のものです）。` +
				`上書きしてしまうので、「${trimmed}」を登録しなおして中身を確かめるか、べつの名前にしてください`
		);
	}

	// 記録は子どもの名前をキーの先頭に持っているので、5つとも付け替える。
	// どれか1つでも忘れると、その子の記録だけが行方不明になる。
	const rekey = <T>(table: Record<string, T>, patch?: (row: T) => void) => {
		for (const [key, row] of Object.entries(table)) {
			const parts = splitKey(key);
			if (parts[0] !== child) continue;
			delete table[key];
			parts[0] = trimmed;
			table[joinKey(...parts)] = row;
			patch?.(row);
		}
	};
	rekey(db.definitions, (row) => {
		row.child = trimmed;
		(row.doc as Doc).child = trimmed;
	});
	rekey(db.definition_history);
	rekey(db.daily_checks);
	rekey(db.flags);
	rekey(db.media_timer);
	return { ok: true, child: trimmed };
}

export function deleteDefinition(db: Db, child: string, year: number | undefined) {
	// 記録（チェック・フラグ・タイマー）は消さない。復活登録すれば戻る。
	for (const key of Object.keys(db.definitions)) {
		const [owner, y] = splitKey(key);
		if (owner !== child) continue;
		if (year !== undefined && Number(y) !== year) continue;
		delete db.definitions[key];
		delete db.definition_history[key];
	}
	return { ok: true };
}

/** その子の記録件数を項目キーごとに数える（項目を消すときの警告に使う）。 */
export function usageOf(db: Db, child: string): Record<string, number> {
	const usage: Record<string, number> = {};
	for (const key of Object.keys(db.daily_checks)) {
		const [owner, , itemKey] = splitKey(key);
		if (owner !== child) continue;
		usage[itemKey] = (usage[itemKey] ?? 0) + 1;
	}
	for (const [key, row] of Object.entries(db.flags)) {
		const [owner, itemKey] = splitKey(key);
		if (owner !== child) continue;
		if (row.value > 0 || row.decision !== null) usage[itemKey] = (usage[itemKey] ?? 0) + 1;
	}
	return usage;
}

/** その子の記録がある日の範囲（無ければ null）。期間を縮めたときの警告に使う。 */
function recordDayRange(db: Db, child: string, year?: number): [string, string] | null {
	const days: string[] = [];
	for (const key of Object.keys(db.daily_checks)) {
		const [owner, day] = splitKey(key);
		if (owner !== child) continue;
		if (year !== undefined && !day.startsWith(`${year}-`)) continue;
		days.push(day);
	}
	if (!days.length) return null;
	days.sort();
	return [days[0], days[days.length - 1]];
}

/** 検証中のドキュメントの年（数字でなければ undefined＝年で絞らない）。 */
function docYear(doc: Doc): number | undefined {
	const year = doc.year;
	return typeof year === 'number' && Number.isInteger(year) ? year : undefined;
}

export function validateFor(db: Db, child: string, doc: Doc) {
	const today = todayJst();
	// 比較相手（前の定義）と記録の範囲は「編集中のドキュメントと同じ年」で取る。
	// 今の年で取ると、年タブで去年を開いて直しているときに、今年の定義や記録と
	// 比べた警告（項目を消した・期間の外に記録がある）が出てしまう。
	const year = docYear(doc);
	const row = rowFor(db, child, year, today);
	return validateDocument(doc, {
		prevDoc: row ? (row.doc as Doc) : null,
		usage: usageOf(db, child),
		recordDays: recordDayRange(db, child, year),
		today
	});
}

export const adminApi = {
	// PIN はサーバ側の仕掛けだった。ブラウザだけの lite では飾りにしかならないので置かない
	// （README にもそう書く）。ゲートを通さない値を返して、3ページの分岐を素通りさせる。
	adminSession: async () => ({ pin_required: false, authenticated: true, admin_disabled: false }),
	adminLogin: async () => ({ ok: true }),

	adminListDefinitions: () => read((db) => ({ definitions: listChildren(db, todayJst()) })),

	adminCreateDefinition: (body: {
		child: string;
		child_kana: string;
		grade: string;
		year: number;
		period: Period;
		template: 'standard' | 'empty';
	}) =>
		mutate((db) => {
			const build = TEMPLATES[body.template] ?? TEMPLATES.standard;
			const doc = build(body.child, body.child_kana, body.grade, body.year, body.period);
			return createDefinition(db, doc);
		}),

	adminGetDefinition: (child: string, year?: number) =>
		read((db) => {
			const row = rowFor(db, child, year, todayJst());
			if (!row) throw new ApiError(404, `「${child}」の定義がみつかりませんでした`);
			return entryOf(db, row);
		}),

	adminSaveDefinition: (child: string, doc: Doc, revision: number, year?: number) =>
		mutate((db) => saveDocument(db, child, doc, revision, year)),

	adminCreateNextYear: (child: string) => mutate((db) => createNextYear(db, child)),

	adminValidateDefinition: (child: string, doc: Doc) =>
		read((db) => validateFor(db, child, doc)),

	adminRenameChild: (child: string, next: string) =>
		mutate((db) => renameChild(db, child, next)),

	adminDeleteDefinition: (child: string, year?: number) =>
		mutate((db) => deleteDefinition(db, child, year)),

	adminUsage: (child: string) => read((db) => ({ usage: usageOf(db, child) })),

	adminImportDefinition: (doc: Doc) => mutate((db) => createDefinition(db, doc)),

	// 学年配当漢字は画面側にも同じ表があるので、そこから返す（往復が1本減る）。
	adminKanji: async () => ({
		grades: Object.fromEntries(GRADE_KANJI_SOURCE.map((chars, i) => [String(i + 1), chars]))
	}),

	adminExportDoc: (child: string, year?: number) =>
		read((db) => {
			const row = rowFor(db, child, year, todayJst());
			if (!row) throw new ApiError(404, `「${child}」の定義がみつかりませんでした`);
			return { filename: `${row.year}-${row.child}.json`, doc: clone(row.doc) };
		})
};

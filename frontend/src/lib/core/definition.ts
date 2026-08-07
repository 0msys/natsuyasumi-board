// 定義ドキュメントの検証と型付け。backend/app/summer/definition.py の移植。
//
// item の key は記録キー（保存側の daily_checks / flags と突き合わせる）。運用開始後に
// key を変えると履歴が切れるので、管理画面は key を利用者に見せず自動採番する。
// 日付は 'YYYY-MM-DD' 文字列のまま持つ（JSON がそうなので、変換して戻す手間を作らない）。
import { isDay, type DayString } from './dates';

/** 定義が壊れているときに投げる。これ以外の例外が出たらパーサ自身のバグ。 */
export class SummerDefinitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SummerDefinitionError';
	}
}

// 3値記録の status（行／キーが無い＝未記入）
export const STATUS_DONE = 'done';
export const STATUS_NOT_DONE = 'not_done';
// 中止（雨天等で行事自体が中止）。cancelable な習慣のみ取りうる第4の status。
// 採点上は done と同じ満点扱い（本人の責でないため点を下げない）。
export const STATUS_CANCELLED = 'cancelled';

// habits の window（記録欄をいつ出すか）
export const WINDOW_EDGES = 'edges'; // はじめ n 日間・おわり n 日間のみ
export const WINDOW_RANGE = 'range'; // window_start〜window_end のみ
const WINDOWS = [WINDOW_EDGES, WINDOW_RANGE];

// やる/やらないの decision（未定は null）
export const DECISION_DO = 'do';
export const DECISION_SKIP = 'skip';

// 日次項目に付けられるメモのフィールド型
export const META_TYPE_TEXT = 'text';
export const META_TYPE_CHOICE = 'choice';
export const META_TYPE_DURATION = 'duration';
const META_TYPES = [META_TYPE_TEXT, META_TYPE_CHOICE, META_TYPE_DURATION];

const GRADE_RE = /^小([1-6])$/;

export const MEDIA_LIMIT_MINUTES_DEFAULT = 120;
export const MEDIA_LIMIT_MINUTES_MAX = 24 * 60;

// window='edges' の「はじめ／おわり」の日数。0以下だと edges の項目が全日ひっこんで
// 採点の分母が黙って変わるので、1〜366 に閉じる。
export const EDGES_WINDOW_DAYS_DEFAULT = 5;
export const EDGES_WINDOW_DAYS_MAX = 366;

export type MetaOption = { key: string; label: string };
export type MetaField = {
	key: string;
	type: string;
	label: string;
	placeholder: string | null;
	options: MetaOption[]; // choice のときのみ
};
export type DailyItem = {
	key: string;
	label: string;
	window: string | null;
	window_start: DayString | null;
	window_end: DayString | null;
	cancelable: boolean;
	meta: MetaField[];
};
export type OneShotItem = {
	key: string;
	label: string;
	required: boolean;
	type: string; // 'flag' | 'count'
	target: number | null;
};
export type ChoiceOption = { key: string; label: string; category: string | null };
export type ChoiceGroup = {
	key: string;
	label: string;
	min_required: number;
	options: ChoiceOption[];
};
export type AwayRange = { start: DayString; end: DayString; label: string };
export type SchoolStartItem = { key: string; label: string; due: DayString };
export type VoiceSettings = { speaker: number; label: string | null };
export type RewardRank = { key: string; label: string; avg: number; prize: string | null };

export type SummerDefinition = {
	child: string;
	child_kana: string;
	year: number;
	grade: string;
	grade_level: number;
	start: DayString;
	end: DayString;
	first_day_of_school: DayString;
	away: AwayRange[];
	card_rules: { edges_window_days: number };
	habits: DailyItem[];
	daily_homework: DailyItem[];
	practice_homework: DailyItem[];
	one_shot_homework: OneShotItem[];
	choice_homework: ChoiceGroup[];
	school_start_items: SchoolStartItem[];
	special_challenges: DailyItem[];
	rewards: RewardRank[];
	voice: VoiceSettings | null;
	media_timer: { limit_minutes: number };
};

type Doc = Record<string, unknown>;

// ---- 入口チェック ----
// 素の Number() や for に渡すと、壊れた定義が「サーバの障害」と見分けのつかない
// 例外になる。ここを通してから使い、投げるのは SummerDefinitionError だけにする。

function require_(data: Doc, key: string, source: string): unknown {
	const value = data[key];
	if (value === undefined || value === null) {
		throw new SummerDefinitionError(`${source}: 必須キー '${key}' がありません`);
	}
	return value;
}

/** 画面に出す文字列（名前・ラベル）。空文字・文字列以外はエラー。
 *
 *  素の String() だと [] が「」、{} が「[object Object]」、0 が「0」という項目名になって
 *  そのまま子どもの画面に出る。しかも検証側は同じ値を「名前を入れてください」で弾くので、
 *  インポートで入った定義が管理画面から二度と保存できなくなる。 */
export const isText = (value: unknown): value is string =>
	typeof value === 'string' && value.trim() !== '';

/** 整数として読めれば その値、読めなければ null（真偽値・小数は不可）。
 *
 *  判定と変換をここ1本に集約するのが要点。パーサと検証（validate.ts）で判定がずれると、
 *  ずれの向きによって「取り込めるのに保存できない」か「保存できたのに子ども画面が
 *  壊れる」のどちらかが起きる。どちらも利用者には直しようがない。 */
export function intLike(value: unknown): number | null {
	if (typeof value === 'boolean') return null;
	if (typeof value === 'number') return Number.isInteger(value) ? value : null;
	if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
	return null;
}

function asText(value: unknown, label: string, source: string): string {
	if (!isText(value)) {
		throw new SummerDefinitionError(
			`${source}: ${label} は名前（文字列）で書いてください: ${JSON.stringify(value)}`
		);
	}
	return value;
}

/** 日付は 'YYYY-MM-DD' だけを受ける。
 *
 *  バックエンド（Python の date.fromisoformat）は "20260721" のような詰めた書きかたも
 *  読むが、こちらは日付を文字列のまま比較するので、そこを許すと大小比較が崩れる。
 *  エクスポートされた JSON の日付は必ず 'YYYY-MM-DD' なので往復では問題にならない。
 *  手書きの変わった書きかたは、黙って通すのではなく弾く側に倒している。 */
function asDate(value: unknown, label: string, source: string): DayString {
	if (typeof value === 'string' && isDay(value)) return value;
	throw new SummerDefinitionError(`${source}: ${label} は日付（YYYY-MM-DD）で書いてください`);
}

/** 整数へ（JSON 手書き向けに数字文字列も受ける）。真偽値・小数・数字でない値はエラー。
 *
 *  真偽値を先に弾くのは Python 側と同じ理由（あちらでは bool が int の一種なので
 *  true が 1 として通ってしまう）。JS には整数と小数の区別が無いので、1.0 は
 *  Python なら小数として弾かれるがここでは 1 として通る——JSON を経由した時点で
 *  区別が消えるので、これは埋められない差として受け入れる。 */
function asInt(value: unknown, label: string, source: string): number {
	const n = intLike(value);
	if (n !== null) return n;
	throw new SummerDefinitionError(
		`${source}: ${label} は整数で書いてください: ${JSON.stringify(value)}`
	);
}

/** asInt ＋ 範囲。範囲を持つ数は必ずこれを通す（範囲を見ないと「保存はできるが
 *  画面が壊れる／採点の分母が黙って変わる」値が通る）。 */
function asBoundedInt(
	value: unknown,
	label: string,
	source: string,
	low: number,
	high: number
): number {
	const n = asInt(value, label, source);
	if (n < low || n > high) {
		throw new SummerDefinitionError(
			`${source}: ${label} は ${low}〜${high} の整数です: ${JSON.stringify(value)}`
		);
	}
	return n;
}

/** 区画を「項目の配列」として取り出す（無ければ空）。配列でなければエラー。
 *  文字列も反復できてしまうので、配列だけ通す（でないと1文字ずつが項目として回る）。 */
function asEntries(raw: unknown, label: string, source: string): unknown[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) {
		throw new SummerDefinitionError(`${source}: ${label} は項目の配列で書いてください`);
	}
	return raw;
}

const isMap = (v: unknown): v is Doc =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** キーが無いときだけ既定値へ倒す。
 *
 *  「キーが無い」と「キーはあるが null」を分けるための小物。Python の
 *  dict.get(key, 既定値) は後者で既定値に倒れず、そのまま None を返して検証で弾かれる。
 *  ここを ?? で書くと null が黙って既定値になり、バックエンドなら「壊れている」と
 *  言われる定義が lite では通ってしまう。 */
const getOr = (data: Doc, key: string, fallback: unknown): unknown =>
	key in data ? data[key] : fallback;

/** Python の真偽評価。null/空文字/0/false/空配列/空オブジェクトが偽。
 *
 *  JS では [] や {} が真なので、素の if で書くと分かれる。定義データは利用者が
 *  手で書けるので、そこに [] が入ったときの結果まで揃えておく。 */
function pyTruthy(v: unknown): boolean {
	if (v === null || v === undefined || v === false) return false;
	if (v === true) return true;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v !== '';
	if (Array.isArray(v)) return v.length > 0;
	if (typeof v === 'object') return Object.keys(v as object).length > 0;
	return Boolean(v);
}

function asEntry(entry: unknown, label: string, source: string): Doc {
	if (!isMap(entry)) {
		throw new SummerDefinitionError(`${source}: ${label} の項目はマップで書いてください`);
	}
	return entry;
}

// ---- 各区画のパース ----

function parseMetaFields(raw: unknown, itemKey: string, source: string): MetaField[] {
	const fields: MetaField[] = [];
	for (const entry of asEntries(raw, `${itemKey}.meta`, source)) {
		if (!isMap(entry) || !('key' in entry) || !('type' in entry)) {
			throw new SummerDefinitionError(`${source}: ${itemKey} の meta 項目に key/type が必要です`);
		}
		const fieldType = String(entry.type);
		if (!META_TYPES.includes(fieldType)) {
			throw new SummerDefinitionError(
				`${source}: ${itemKey}.meta.type は ${META_TYPES.join('/')} のいずれかです: ${fieldType}`
			);
		}
		let options: MetaOption[] = [];
		if (fieldType === META_TYPE_CHOICE) {
			const rawOptions = asEntries(entry.options, `${itemKey}.${entry.key}.options`, source);
			if (rawOptions.length === 0) {
				throw new SummerDefinitionError(
					`${source}: choice 型 '${itemKey}.${entry.key}' には options が必要です`
				);
			}
			options = rawOptions
				.filter((o): o is Doc => isMap(o) && 'key' in o && 'label' in o)
				.map((o) => ({
					key: String(o.key),
					label: asText(o.label, `${itemKey}.options.label`, source)
				}));
			if (options.length !== rawOptions.length) {
				throw new SummerDefinitionError(
					`${source}: ${itemKey}.${entry.key} の options に key/label が必要です`
				);
			}
		}
		fields.push({
			key: String(entry.key),
			type: fieldType,
			label: asText(getOr(entry, 'label', entry.key), `${itemKey}.meta.label`, source),
			placeholder: pyTruthy(entry.placeholder) ? String(entry.placeholder) : null,
			options
		});
	}
	const keys = fields.map((f) => f.key);
	if (keys.length !== new Set(keys).size) {
		throw new SummerDefinitionError(`${source}: ${itemKey} の meta フィールド key が重複しています`);
	}
	return fields;
}

function parseDailyItems(raw: unknown, section: string, source: string): DailyItem[] {
	const items: DailyItem[] = [];
	for (const entry of asEntries(raw, section, source)) {
		if (!isMap(entry) || !('key' in entry) || !('label' in entry)) {
			throw new SummerDefinitionError(`${source}: ${section} の項目に key/label が必要です`);
		}
		const key = String(entry.key);
		const window = entry.window ?? null;
		let windowStart: DayString | null = null;
		let windowEnd: DayString | null = null;
		if (window !== null && window !== undefined) {
			if (typeof window !== 'string' || !WINDOWS.includes(window)) {
				throw new SummerDefinitionError(
					`${source}: ${key}.window は ${WINDOWS.join('/')} のいずれかです: ${String(window)}`
				);
			}
			if (window === WINDOW_RANGE) {
				windowStart = asDate(require_(entry, 'window_start', source), `${key}.window_start`, source);
				windowEnd = asDate(require_(entry, 'window_end', source), `${key}.window_end`, source);
				if (windowStart > windowEnd) {
					throw new SummerDefinitionError(
						`${source}: ${key} は window_start <= window_end にしてください`
					);
				}
			}
		}
		items.push({
			key,
			label: asText(entry.label, `${section}.label`, source),
			window: (window as string | null) ?? null,
			window_start: windowStart,
			window_end: windowEnd,
			cancelable: pyTruthy(getOr(entry, 'cancelable', false)),
			meta: parseMetaFields(entry.meta, key, source)
		});
	}
	return items;
}

function parseRewards(raw: unknown, source: string): RewardRank[] {
	const ranks: RewardRank[] = [];
	let prevAvg: number | null = null;
	for (const entry of asEntries(raw, 'rewards', source)) {
		if (!isMap(entry) || !('key' in entry) || !('label' in entry) || !('avg' in entry)) {
			throw new SummerDefinitionError(`${source}: rewards の項目に key/label/avg が必要です`);
		}
		const avg = entry.avg;
		if (typeof avg !== 'number' || !Number.isInteger(avg) || avg <= 0) {
			throw new SummerDefinitionError(
				`${source}: rewards '${String(entry.key)}' の avg は 1 以上の整数です`
			);
		}
		if (prevAvg !== null && avg <= prevAvg) {
			throw new SummerDefinitionError(
				`${source}: rewards は avg の昇順（小さい→大きい）で並べてください`
			);
		}
		prevAvg = avg;
		ranks.push({
			key: String(entry.key),
			label: asText(entry.label, 'rewards.label', source),
			avg,
			prize: entry.prize !== undefined && entry.prize !== null ? String(entry.prize) : null
		});
	}
	const keys = ranks.map((r) => r.key);
	if (keys.length !== new Set(keys).size) {
		throw new SummerDefinitionError(`${source}: rewards の key が重複しています`);
	}
	return ranks;
}

function parseVoice(raw: unknown, source: string): VoiceSettings | null {
	if (raw === undefined || raw === null) return null;
	if (!isMap(raw)) throw new SummerDefinitionError(`${source}: voice はオブジェクトです`);
	const speaker = raw.speaker;
	if (typeof speaker !== 'number' || !Number.isInteger(speaker) || speaker < 0) {
		throw new SummerDefinitionError(
			`${source}: voice.speaker は 0 以上の整数（VOICEVOX の話者ID）です`
		);
	}
	return { speaker, label: pyTruthy(raw.label) ? String(raw.label) : null };
}

function parseMediaTimer(raw: unknown, source: string): { limit_minutes: number } {
	if (raw === undefined || raw === null) return { limit_minutes: MEDIA_LIMIT_MINUTES_DEFAULT };
	if (!isMap(raw)) throw new SummerDefinitionError(`${source}: media_timer はオブジェクトです`);
	const minutes = getOr(raw, 'limit_minutes', MEDIA_LIMIT_MINUTES_DEFAULT);
	if (
		typeof minutes !== 'number' ||
		!Number.isInteger(minutes) ||
		minutes < 1 ||
		minutes > MEDIA_LIMIT_MINUTES_MAX
	) {
		throw new SummerDefinitionError(
			`${source}: media_timer.limit_minutes は 1〜${MEDIA_LIMIT_MINUTES_MAX} の整数（分）です`
		);
	}
	return { limit_minutes: minutes };
}

/** 学年表記（小1〜小6）を検証して [表示文字列, 数値] を返す。 */
export function parseGrade(value: unknown, source: string): [string, number] {
	const grade = value === undefined || value === null ? '' : String(value);
	const m = GRADE_RE.exec(grade);
	if (!m) {
		throw new SummerDefinitionError(
			`${source}: grade は 小1〜小6 のいずれかで書いてください: ${JSON.stringify(grade)}`
		);
	}
	return [grade, Number(m[1])];
}

/** 定義ドキュメントを検証して SummerDefinition にする。壊れていれば SummerDefinitionError。
 *
 *  ここを try/catch で包んで例外を SummerDefinitionError に変換してはいけない：
 *  パーサ自身のバグまで「あなたの定義が壊れています」と報告してしまい、利用者は
 *  壊れていない定義を直しに行くことになる。 */
export function parseDefinition(doc: unknown, source = '定義'): SummerDefinition {
	if (!isMap(doc)) throw new SummerDefinitionError(`${source}: トップレベルがマップではありません`);

	const period = require_(doc, 'period', source);
	if (!isMap(period)) throw new SummerDefinitionError(`${source}: period はマップで書いてください`);
	const start = asDate(require_(period, 'start', source), 'period.start', source);
	const end = asDate(require_(period, 'end', source), 'period.end', source);
	const firstDay = asDate(
		require_(period, 'first_day_of_school', source),
		'period.first_day_of_school',
		source
	);
	if (!(start < end && end < firstDay)) {
		throw new SummerDefinitionError(
			`${source}: period は start < end < first_day_of_school の順にしてください`
		);
	}

	const away: AwayRange[] = asEntries(doc.away, 'away', source)
		.map((entry) => asEntry(entry, 'away', source))
		.map((e) => ({
			start: asDate(require_(e, 'start', source), 'away.start', source),
			end: asDate(require_(e, 'end', source), 'away.end', source),
			label: asText(require_(e, 'label', source), 'away.label', source)
		}));

	// card_rules は既定値を持つので区画ごと無くても読める。ただし「無い」と「壊れている」は
	// 分ける: [] や 0 や "" を黙って既定値にすると、parse は通るのに検証は弾く定義ができる
	// （＝インポートはできるのに管理画面から二度と保存できない子）。
	// `?? {}` にしないのは、card_rules が null のときは Python 側でも {} 相当に倒れるが、
	// [] や 0 のときは「壊れている」として弾かれるため（この行の下で型を見る）。
	const cardRaw = doc.card_rules === undefined || doc.card_rules === null ? {} : doc.card_rules;
	if (!isMap(cardRaw)) throw new SummerDefinitionError(`${source}: card_rules はオブジェクトです`);
	const cardRules = {
		edges_window_days: asBoundedInt(
			getOr(cardRaw, 'edges_window_days', EDGES_WINDOW_DAYS_DEFAULT),
			'card_rules.edges_window_days',
			source,
			1,
			EDGES_WINDOW_DAYS_MAX
		)
	};

	const habits = parseDailyItems(doc.habits, 'habits', source);
	const dailyHomework = parseDailyItems(doc.daily_homework, 'daily_homework', source);
	const practiceHomework = parseDailyItems(doc.practice_homework, 'practice_homework', source);
	const specialChallenges = parseDailyItems(doc.special_challenges, 'special_challenges', source);
	const rewards = parseRewards(doc.rewards, source);

	const oneShot: OneShotItem[] = [];
	for (const entry of asEntries(doc.one_shot_homework, 'one_shot_homework', source)) {
		if (!isMap(entry) || !('key' in entry) || !('label' in entry)) {
			throw new SummerDefinitionError(`${source}: one_shot_homework の項目に key/label が必要です`);
		}
		const itemType = String(getOr(entry, 'type', 'flag'));
		if (itemType !== 'flag' && itemType !== 'count') {
			throw new SummerDefinitionError(
				`${source}: one_shot_homework.type は flag か count です: ${String(entry.key)}`
			);
		}
		const target = entry.target;
		if (
			itemType === 'count' &&
			(typeof target !== 'number' || !Number.isInteger(target) || target < 1)
		) {
			throw new SummerDefinitionError(
				`${source}: count 型 '${String(entry.key)}' には target（1以上の整数）が必要です`
			);
		}
		oneShot.push({
			key: String(entry.key),
			label: asText(entry.label, 'one_shot_homework.label', source),
			required: pyTruthy(getOr(entry, 'required', true)),
			type: itemType,
			target: itemType === 'count' ? (target as number) : null
		});
	}

	const choiceGroups: ChoiceGroup[] = [];
	for (const entry of asEntries(doc.choice_homework, 'choice_homework', source)) {
		if (!isMap(entry) || !('key' in entry) || !('options' in entry)) {
			throw new SummerDefinitionError(`${source}: choice_homework の項目に key/options が必要です`);
		}
		const groupKey = String(entry.key);
		const options: ChoiceOption[] = asEntries(entry.options, `${groupKey}.options`, source)
			.map((o) => asEntry(o, `${groupKey}.options`, source))
			.map((o) => ({
				// 選択肢の key はグループ key とドットで連結する（保存側で一意にするため）
				key: `${groupKey}.${String(require_(o, 'key', source))}`,
				label: asText(require_(o, 'label', source), `${groupKey}.options.label`, source),
				category: o.category === undefined ? null : (o.category as string | null)
			}));
		const minRequired = asInt(
			getOr(entry, 'min_required', 1),
			`${groupKey}.min_required`,
			source
		);
		if (minRequired < 1 || minRequired > options.length) {
			throw new SummerDefinitionError(
				`${source}: choice_homework '${groupKey}' の min_required が選択肢数と矛盾しています`
			);
		}
		choiceGroups.push({
			key: groupKey,
			label: asText(require_(entry, 'label', source), `${groupKey}.label`, source),
			min_required: minRequired,
			options
		});
	}

	const schoolStart: SchoolStartItem[] = asEntries(
		doc.school_start_items,
		'school_start_items',
		source
	)
		.map((entry) => asEntry(entry, 'school_start_items', source))
		.map((e) => ({
			key: String(require_(e, 'key', source)),
			label: asText(require_(e, 'label', source), 'school_start_items.label', source),
			due: asDate(require_(e, 'due', source), 'school_start_items.due', source)
		}));

	const childName = asText(require_(doc, 'child', source), 'child', source);
	const [grade, gradeLevel] = parseGrade(require_(doc, 'grade', source), source);

	const definition: SummerDefinition = {
		child: childName,
		child_kana: pyTruthy(doc.child_kana) ? String(doc.child_kana) : childName,
		year: asInt(require_(doc, 'year', source), 'year', source),
		grade,
		grade_level: gradeLevel,
		start,
		end,
		first_day_of_school: firstDay,
		away,
		card_rules: cardRules,
		habits,
		daily_homework: dailyHomework,
		practice_homework: practiceHomework,
		one_shot_homework: oneShot,
		choice_homework: choiceGroups,
		school_start_items: schoolStart,
		special_challenges: specialChallenges,
		rewards,
		voice: parseVoice(doc.voice, source),
		media_timer: parseMediaTimer(doc.media_timer, source)
	};

	// key の一意性。日次系と flags 系は保存先が別なので、別の空間として検査する。
	const dailyKeys = dailyItems(definition).map((i) => i.key);
	if (dailyKeys.length !== new Set(dailyKeys).size) {
		throw new SummerDefinitionError(
			`${source}: habits/daily/practice/challenges の key が重複しています`
		);
	}
	const flagKeys = [...flagItemKeysList(definition)];
	if (flagKeys.length !== new Set(flagKeys).size) {
		throw new SummerDefinitionError(
			`${source}: one_shot/school_start/choice の key が重複しています`
		);
	}

	return definition;
}

// ---- 定義から引くための小物（Python 側はメソッドだったもの） ----

/** 日次3値記録の全項目。スペシャルチャレンジも同じ場所に記録されるので含める。 */
export const dailyItems = (d: SummerDefinition): DailyItem[] => [
	...d.habits,
	...d.daily_homework,
	...d.practice_homework,
	...d.special_challenges
];

export const dailyItemKeys = (d: SummerDefinition): Set<string> =>
	new Set(dailyItems(d).map((i) => i.key));

export const dailyItem = (d: SummerDefinition, key: string): DailyItem | null =>
	dailyItems(d).find((i) => i.key === key) ?? null;

/** flags 側の item_key を並び順のまま返す（重複検査に使うので Set にしない）。 */
function flagItemKeysList(d: SummerDefinition): string[] {
	const keys = [
		...d.one_shot_homework.map((i) => i.key),
		...d.school_start_items.map((i) => i.key)
	];
	for (const group of d.choice_homework) keys.push(...group.options.map((o) => o.key));
	return keys;
}

export const flagItemKeys = (d: SummerDefinition): Set<string> => new Set(flagItemKeysList(d));

export const inPeriod = (d: SummerDefinition, day: DayString): boolean =>
	d.start <= day && day <= d.end;

export function awayLabel(d: SummerDefinition, day: DayString): string | null {
	for (const range of d.away) {
		if (range.start <= day && day <= range.end) return range.label;
	}
	return null;
}

export const metaField = (item: DailyItem, key: string): MetaField | null =>
	item.meta.find((f) => f.key === key) ?? null;

/** メモ1フィールドの値を人が読める短文にする（表示・読み上げで共用）。 */
export function formatMetaValue(field: MetaField, value: unknown): string {
	if (field.type === META_TYPE_CHOICE) {
		const label = field.options.find((o) => o.key === value)?.label ?? String(value);
		return `${field.label}は${label}`;
	}
	if (field.type === META_TYPE_DURATION) {
		const n = typeof value === 'number' ? value : Number(value);
		if (!Number.isFinite(n)) return `${field.label}は${String(value)}`;
		const secs = Math.max(Math.trunc(n), 0);
		const minutes = Math.floor(secs / 60);
		const seconds = secs % 60;
		const span = minutes ? `${minutes}分${seconds}秒` : `${seconds}秒`;
		return `${field.label}は${span}`;
	}
	return `${field.label}は${String(value)}`;
}

/** doc から期間を素朴に取り出す（読めなければ null）。使い道は「どの年を出すか」の選択だけ。 */
export function periodBounds(doc: unknown): [DayString, DayString] | null {
	if (!isMap(doc)) return null;
	const period = doc.period;
	if (!isMap(period)) return null;
	const { start, end } = period;
	if (typeof start === 'string' && typeof end === 'string' && start <= end) return [start, end];
	return null;
}

/**
 * 複数年の定義から「いま画面に出す年」を1つ選ぶ。
 *
 * 優先順:
 *   1. 今日を含む期間の年 — 夏休みの最中はその年で確定。来年ぶんを夏の最中に作っても
 *      画面は今年のまま（年またぎでいちばん壊したくない性質）
 *   2. 直近に終わった夏（end < 今日 のうち end が最大）— 9月以降も今年の記録を見返せる
 *   3. これから来る夏（start > 今日 のうち start が最小）— 初回登録を早めにした直後
 *   4. 期間が読めない年（壊れた定義）— 他に候補が無いときだけ。年の大きいほう
 * 同点は年の大きいほうを採る（どの端末で見ても同じ年になるよう決定的にする）。
 */
export function selectDefinitionYear(
	candidates: readonly (readonly [number, readonly [DayString, DayString] | null])[],
	today: DayString
): number {
	const dated = candidates.filter(
		(c): c is readonly [number, readonly [DayString, DayString]] => c[1] !== null
	);
	const current = dated.filter(([, b]) => b[0] <= today && today <= b[1]).map(([y]) => y);
	if (current.length) return Math.max(...current);

	const past = dated.filter(([, b]) => b[1] < today);
	if (past.length) {
		// end が最大、同点なら年が大きいほう
		return past.reduce((best, e) =>
			e[1][1] > best[1][1] || (e[1][1] === best[1][1] && e[0] > best[0]) ? e : best
		)[0];
	}

	const future = dated.filter(([, b]) => b[0] > today);
	if (future.length) {
		// start が最小、同点なら年が大きいほう
		return future.reduce((best, e) =>
			e[1][0] < best[1][0] || (e[1][0] === best[1][0] && e[0] > best[0]) ? e : best
		)[0];
	}

	return Math.max(...candidates.map(([y]) => y));
}

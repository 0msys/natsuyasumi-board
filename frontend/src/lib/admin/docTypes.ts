// 定義ドキュメント（AdminDocument）の編集用型と小さな純関数ヘルパー。
// サーバの JSON をそのまま持ち、key が空（null）の項目は保存時にサーバが採番する
// （backend/app/admin/definition_store.py assign_keys）。key は UI に一切表示しない。
// 例外: メモ欄（meta）の choice 選択肢の key はサーバ採番の対象外なので、
// 追加時にクライアントで newKey('mo_') を振る。
// 壊れた定義も開いて直せるよう、全フィールドを optional として扱う。

export type DocPeriod = { start: string; end: string; first_day_of_school: string };
export type DocAway = { start?: string; end?: string; label?: string };
export type DocCardRules = { edges_window_days?: number };
// テレビタイマーの上限（分）。区画ごと無ければサーバ既定の120分（2時間）。
export type DocMediaTimer = { limit_minutes?: number };
export type DocMetaOption = { key: string | null; label?: string };
export type DocMetaField = {
	key: string | null;
	type?: 'text' | 'choice' | 'duration';
	label?: string;
	placeholder?: string | null;
	options?: DocMetaOption[];
};
export type DocDailyItem = {
	key: string | null;
	label?: string;
	window?: 'edges' | 'range' | null;
	window_start?: string | null;
	window_end?: string | null;
	cancelable?: boolean;
	meta?: DocMetaField[];
};
export type DocOneShot = {
	key: string | null;
	label?: string;
	required?: boolean;
	type?: 'flag' | 'count';
	target?: number | null;
};
export type DocChoiceOption = { key: string | null; label?: string; category?: string | null };
export type DocChoiceGroup = {
	key: string | null;
	label?: string;
	min_required?: number;
	options?: DocChoiceOption[];
};
export type DocSchoolStartItem = { key: string | null; label?: string; due?: string };
// 読み上げの声（VOICEVOX の話者ID。区画ごと無ければサーバ既定の話者）。
// label は表示用のキャッシュで、合成に使うのは speaker だけ。
export type DocVoice = { speaker?: number; label?: string | null };
export type DocReward = { key: string | null; label?: string; avg?: number; prize?: string | null };

export type DefinitionDoc = {
	child?: string;
	child_kana?: string;
	year?: number;
	grade?: string;
	period?: DocPeriod;
	voice?: DocVoice;
	away?: DocAway[];
	card_rules?: DocCardRules;
	media_timer?: DocMediaTimer;
	habits?: DocDailyItem[];
	daily_homework?: DocDailyItem[];
	special_challenges?: DocDailyItem[];
	rewards?: DocReward[];
	one_shot_homework?: DocOneShot[];
	choice_homework?: DocChoiceGroup[];
	school_start_items?: DocSchoolStartItem[];
	[key: string]: unknown; // 未知フィールドは保存時もそのまま維持する
};

export const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6'] as const;

/** 「小1」〜「小6」→ 1〜6。壊れた学年は 0（＝漢字 lint はオフ。サーバと同じ扱い）. */
export function gradeLevelOf(grade: unknown): number {
	const m = /^小([1-6])$/.exec(String(grade ?? ''));
	return m ? Number(m[1]) : 0;
}

/** テレビタイマーの上限（分）の既定値と入力範囲（backend/app/summer/definition.py と同値）. */
export const MEDIA_LIMIT_MINUTES_DEFAULT = 120;
export const MEDIA_LIMIT_MINUTES_MAX = 24 * 60;

/** 「はじめとおわりだけ」の窓の日数（backend/app/summer/definition.py と同値）.
 *  0以下は edges の記録欄が全日ひっこんで採点の分母が変わり、巨大値はサーバの日付計算が
 *  あふれる。サーバが 1〜366 に閉じているので、入力欄も同じ範囲に閉じる。 */
export const EDGES_WINDOW_DAYS_DEFAULT = 5;
export const EDGES_WINDOW_DAYS_MAX = 366;

/** 分 → 「1時間30分」のような親向け表記。組み立ては子ども画面の上限ラベル
 * （backend/app/summer/ui_text.py media_limit_label）と同じで、ちょうどの時間は「0分」を付けない. */
export function formatMinutes(minutes: number): string {
	const m = Math.max(0, Math.floor(minutes));
	const h = Math.floor(m / 60);
	const rest = m % 60;
	if (!h) return `${rest}分`;
	return rest ? `${h}時間${rest}分` : `${h}時間`;
}

/** period の日数（start〜end 両端込み）。日付が壊れていれば null. */
export function daysTotal(period: DocPeriod | undefined): number | null {
	if (!period?.start || !period?.end) return null;
	const start = Date.parse(period.start);
	const end = Date.parse(period.end);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
	return Math.round((end - start) / 86_400_000) + 1;
}

/** 配列要素を上下に動かす（動いたら true）. */
export function moveItem<T>(arr: T[], index: number, delta: number): boolean {
	const target = index + delta;
	if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return false;
	const [item] = arr.splice(index, 1);
	arr.splice(target, 0, item);
	return true;
}

const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** クライアント採番キー（メモ欄 choice 選択肢用。他の区画はサーバが採番する）. */
export function newKey(prefix: string): string {
	let key = prefix;
	for (let i = 0; i < 6; i++) key += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
	return key;
}

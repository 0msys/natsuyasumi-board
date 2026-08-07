// ブラウザに置くデータの形。
//
// バックエンド版の SQLite が持っていた5つのテーブルを、そのまま5つの辞書として持つ。
// 複合キーは UNIQUE INDEX と1対1に対応させる。区切りは U+0000（NUL）で、子どもの名前にも
// 項目キーにも現れない。| や : や空白だと、名前しだいで別のキーとぶつかりうる。
//
// 全体を1つのドキュメントとして丸ごと読み書きするので、
//   - 「revision を上げつつ履歴を積んで10世代に切る」のような複数テーブルにまたがる
//     操作が、ただのオブジェクト操作になる（トランザクションを組まなくていい）
//   - エクスポートが「いまの中身を JSON にする」で済む
//   - 保存の実体を差し替えられる＝テストが IndexedDB 無しで全部通る
// 代わりに1回の書き込みで全体を書き直すが、実測で数百KB・数ミリ秒なので問題にならない。
import type { DayString } from '$lib/core/dates';

export const SCHEMA_VERSION = 1;

/** 子ども×年の定義。SQLite の UNIQUE(child, year) に対応。 */
export type DefinitionRow = {
	child: string;
	year: number;
	doc: Record<string, unknown>;
	revision: number;
	updated_at: number;
};
export type HistoryRow = { revision: number; doc: Record<string, unknown>; saved_at: number };
/** 日次3値記録。**キーが無い＝未記入**（status を null にしない）。 */
export type CheckRow = {
	status: string;
	checked_at: number;
	meta: Record<string, unknown> | null;
};
export type FlagRow = { value: number; decision: string | null; updated_at: number };
export type TimerRow = {
	accumulated_seconds: number;
	running: boolean;
	resumed_at: number | null;
	updated_at: number;
};

export type Meta = {
	/** 書き込みの通番。多タブの取り合いとバックアップの催促に使う。 */
	seq: number;
	last_backup_at: number | null;
	last_backup_seq: number;
	/** navigator.storage.persist() の結果（まだ聞いていなければ null）。 */
	persisted: boolean | null;
	/** 最後に見た「今日」。端末の日付が巻き戻ったことに気づくため。 */
	last_seen_day: DayString | null;
	/** ホーム画面に追加の案内を閉じたか。 */
	home_hint_dismissed: boolean;
};

export type Db = {
	schema_version: number;
	definitions: Record<string, DefinitionRow>;
	definition_history: Record<string, HistoryRow[]>; // 新しい順
	daily_checks: Record<string, CheckRow>;
	flags: Record<string, FlagRow>;
	media_timer: Record<string, TimerRow>;
	meta: Meta;
};

/** 子ども×年ごとに残す履歴の世代数。 */
export const HISTORY_KEEP = 10;

const SEP = '\u0000';

export const defKey = (child: string, year: number): string => `${child}${SEP}${year}`;
export const checkKey = (child: string, day: DayString, itemKey: string): string =>
	`${child}${SEP}${day}${SEP}${itemKey}`;
/**
 * flags のキー。**年を持たない**（バックエンドの UNIQUE(child, item_key) と同じ）。
 *
 * これは年をまたぐと項目キーを振り直す運用と対で成立している。ここに年を足したく
 * なっても足してはいけない代わりに、**年をまたいだコピーでは必ずキーを振り直す**こと
 * （$lib/core/keys の stripKeys）。どちらか片方だけを崩すと、去年の「絵日記できた」
 * 「読書5冊」が今年も済み扱いのまま出てくる。
 */
export const flagKey = (child: string, itemKey: string): string => `${child}${SEP}${itemKey}`;
export const timerKey = (child: string, day: DayString): string => `${child}${SEP}${day}`;

/** キーの先頭にある子ども名を取り出す（改名で全キーを付け替えるときに使う）。 */
export const splitKey = (key: string): string[] => key.split(SEP);
export const joinKey = (...parts: (string | number)[]): string => parts.join(SEP);

export function emptyDb(): Db {
	return {
		schema_version: SCHEMA_VERSION,
		definitions: {},
		definition_history: {},
		daily_checks: {},
		flags: {},
		media_timer: {},
		meta: {
			seq: 0,
			last_backup_at: null,
			last_backup_seq: 0,
			persisted: null,
			last_seen_day: null,
			home_hint_dismissed: false
		}
	};
}

/** 読み込んだものを Db として整える（欠けている区画を足す）。
 *
 *  古いバックアップの取り込みや、途中で足した meta のために要る。ここで埋めておけば
 *  以降のコードは区画の有無を気にしなくてよい。 */
export function normalizeDb(raw: unknown): Db {
	const base = emptyDb();
	if (typeof raw !== 'object' || raw === null) return base;
	const src = raw as Partial<Db>;
	return {
		schema_version: typeof src.schema_version === 'number' ? src.schema_version : SCHEMA_VERSION,
		definitions: { ...base.definitions, ...(src.definitions ?? {}) },
		definition_history: { ...base.definition_history, ...(src.definition_history ?? {}) },
		daily_checks: { ...base.daily_checks, ...(src.daily_checks ?? {}) },
		flags: { ...base.flags, ...(src.flags ?? {}) },
		media_timer: { ...base.media_timer, ...(src.media_timer ?? {}) },
		meta: { ...base.meta, ...(src.meta ?? {}) }
	};
}

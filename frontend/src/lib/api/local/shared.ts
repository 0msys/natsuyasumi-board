// lite 版 api の共通部分（定義の読み出しと、保存層からの取り出し）。
import { todayJst, nowEpochSec } from '$lib/core/clock';
import type { DayString } from '$lib/core/dates';
import {
	SummerDefinitionError,
	parseDefinition,
	periodBounds,
	selectDefinitionYear,
	type SummerDefinition
} from '$lib/core/definition';
import type { ChecksByDay, FlagsByKey, MetaByDay } from '$lib/core/state';
import { checkKey, defKey, flagKey, splitKey, type Db, type DefinitionRow } from '$lib/store/model';
import { ApiError } from '../contract';

export { todayJst, nowEpochSec };

/** その子の定義が入っている年を並べる（昇順）。 */
export function yearsOf(db: Db, child: string): number[] {
	return Object.values(db.definitions)
		.filter((row) => row.child === child)
		.map((row) => row.year)
		.sort((a, b) => a - b);
}

/** 「いま出す年」の行を選ぶ（無ければ null）。 */
export function pickRow(db: Db, child: string, today: DayString): DefinitionRow | null {
	const rows = Object.values(db.definitions).filter((row) => row.child === child);
	if (rows.length === 0) return null;
	if (rows.length === 1) return rows[0];
	const year = selectDefinitionYear(
		rows.map((row) => [row.year, periodBounds(row.doc)] as const),
		today
	);
	return rows.find((row) => row.year === year) ?? rows[0];
}

/** 読み書きの前に定義を取り出す。無い・壊れているときはバックエンドと同じく 503 相当。 */
export function loadDefinition(db: Db, child: string, today: DayString): SummerDefinition {
	const row = pickRow(db, child, today);
	if (!row) throw new ApiError(503, `「${child}」の定義がありません`);
	try {
		return parseDefinition(row.doc, `${child}（${row.year}年）`);
	} catch (e) {
		if (e instanceof SummerDefinitionError) throw new ApiError(503, e.message);
		throw e;
	}
}

/** 指定年の行（省略時は「いま出す年」）。 */
export function rowFor(db: Db, child: string, year: number | undefined, today: DayString) {
	if (year === undefined) return pickRow(db, child, today);
	return db.definitions[defKey(child, year)] ?? null;
}

/** 期間内の日次記録を {日: {項目キー: 状態}} で取り出す。 */
export function readChecks(db: Db, child: string, from: DayString, to: DayString): ChecksByDay {
	const out: ChecksByDay = {};
	for (const [key, row] of Object.entries(db.daily_checks)) {
		const [owner, day, itemKey] = splitKey(key);
		if (owner !== child || day < from || day > to) continue;
		(out[day] ??= {})[itemKey] = row.status;
	}
	return out;
}

/** 期間内のメモを {日: {項目キー: メモ}} で取り出す（メモが空の行は入れない）。 */
export function readMeta(db: Db, child: string, from: DayString, to: DayString): MetaByDay {
	const out: MetaByDay = {};
	for (const [key, row] of Object.entries(db.daily_checks)) {
		if (!row.meta || Object.keys(row.meta).length === 0) continue;
		const [owner, day, itemKey] = splitKey(key);
		if (owner !== child || day < from || day > to) continue;
		(out[day] ??= {})[itemKey] = row.meta;
	}
	return out;
}

/** その子のフラグを {項目キー: 値} で取り出す。 */
export function readFlags(db: Db, child: string): FlagsByKey {
	const out: FlagsByKey = {};
	for (const [key, row] of Object.entries(db.flags)) {
		const [owner, itemKey] = splitKey(key);
		if (owner !== child) continue;
		out[itemKey] = { value: row.value, decision: row.decision };
	}
	return out;
}

export const checkRowKey = checkKey;
export const flagRowKey = flagKey;

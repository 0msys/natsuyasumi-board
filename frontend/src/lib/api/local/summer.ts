// 子どもページの api（lite 版）。backend/app/summer/service.py の読み書きの移植。
//
// エラー文言は子ども向けのひらがなのまま持ってくる。画面にそのまま出るので、
// ここを英語や開発者向けの言い回しに変えない。
import { isDay, type DayString } from '$lib/core/dates';
import {
	DECISION_DO,
	DECISION_SKIP,
	META_TYPE_CHOICE,
	META_TYPE_DURATION,
	META_TYPE_TEXT,
	STATUS_CANCELLED,
	STATUS_DONE,
	STATUS_NOT_DONE,
	dailyItem,
	dailyItemKeys,
	flagItemKeys,
	inPeriod,
	parseDefinition,
	type MetaField,
	type OneShotItem,
	type SummerDefinition
} from '$lib/core/definition';
import { canSkip, remainingToday } from '$lib/core/judge';
import { buildTodoSpeechText } from '$lib/core/speech';
import {
	COUNT_MAX,
	META_DURATION_MAX,
	META_TEXT_MAX,
	buildState
} from '$lib/core/state';
import { awayLabel } from '$lib/core/definition';
import { mediaLimitLabel } from '$lib/core/uiText';
import { GRADE_MIN } from '$lib/core/kanji';
import { MEDIA_LIMIT_MINUTES_DEFAULT } from '$lib/core/definition';
import { mutate, read } from '$lib/store/db';
import { checkKey, flagKey, timerKey, type Db } from '$lib/store/model';
import { ApiError } from '../contract';
import type { SummerCheckStatus, SummerDecision, SummerMeta } from '../types';
import {
	loadDefinition,
	nowEpochSec,
	pickRow,
	readChecks,
	readFlags,
	readMeta,
	todayJst,
	yearsOf
} from './shared';

/** 書き込みが弾かれたときの例外。文言はそのまま子どもの画面に出る。 */
const writeError = (detail: string) => new ApiError(400, detail);

export function listChildren(db: Db, today: DayString) {
	const names = [...new Set(Object.values(db.definitions).map((r) => r.child))].sort();
	return names.map((child) => {
		const row = pickRow(db, child, today)!;
		const base = {
			child,
			year: row.year,
			years: yearsOf(db, child),
			revision: row.revision,
			updated_at: row.updated_at
		};
		try {
			const d = parseDefinition(row.doc, `${child}（${row.year}年）`);
			return {
				...base,
				valid: true,
				error: null,
				child_kana: d.child_kana,
				grade: d.grade,
				period: {
					start: d.start,
					end: d.end,
					first_day_of_school: d.first_day_of_school
				}
			};
		} catch (e) {
			// 壊れた定義も一覧から消さない（親が管理画面で直せるようにするため）
			return {
				...base,
				valid: false,
				error: e instanceof Error ? e.message : String(e),
				child_kana: child,
				grade: null,
				period: null
			};
		}
	});
}

export function stateFor(db: Db, child: string, today: DayString) {
	const definition = loadDefinition(db, child, today);
	return buildState({
		definition,
		today,
		checks: readChecks(db, child, definition.start, definition.end),
		metaByDay: readMeta(db, child, definition.start, definition.end),
		flags: readFlags(db, child)
	});
}

// ---- 日次3値記録 ----

export function setCheck(
	db: Db,
	child: string,
	day: DayString,
	itemKey: string,
	status: SummerCheckStatus
): SummerCheckStatus {
	const today = todayJst();
	const definition = loadDefinition(db, child, today);
	if (!isDay(day)) throw writeError('ひづけが うまく よめなかったよ');
	if (!dailyItemKeys(definition).has(itemKey)) throw writeError('その こうもくが みつからないよ');
	if (!inPeriod(definition, day)) throw writeError('なつやすみの きかんじゃ ないひだよ');
	if (day > today) throw writeError('まだ さきのひは かけないよ');

	const allowed = new Set<string | null>([STATUS_DONE, STATUS_NOT_DONE, null]);
	const item = dailyItem(definition, itemKey);
	if (item?.cancelable) allowed.add(STATUS_CANCELLED); // 中止（雨天等）は cancelable 項目のみ
	if (!allowed.has(status)) throw writeError('その きろくは できないみたい');

	const key = checkKey(child, day, itemKey);
	if (status === null) {
		// 行ごと消す＝未記入に戻す。null を入れて残すと、集計が「記録あり」と見てしまう。
		delete db.daily_checks[key];
		return null;
	}
	const current = db.daily_checks[key];
	db.daily_checks[key] = {
		status,
		checked_at: nowEpochSec(),
		// done は既存のメモを残す（あとから入力欄で足せる）。
		// やらなかった・中止の日にメモは残さない。
		meta: status === STATUS_DONE ? (current?.meta ?? null) : null
	};
	return status;
}

function findMetaItem(definition: SummerDefinition, itemKey: string) {
	for (const item of [...definition.daily_homework, ...definition.practice_homework]) {
		if (item.key === itemKey && item.meta.length) return item;
	}
	return null;
}

/** メモ1フィールドの値を検証・正規化する。空・null は「消す」を表す null を返す。 */
function normalizeMetaValue(field: MetaField, value: unknown): unknown | null {
	if (value === null || value === undefined) return null;
	if (field.type === META_TYPE_TEXT) {
		const text = String(value).trim();
		return text ? text.slice(0, META_TEXT_MAX) : null;
	}
	if (field.type === META_TYPE_CHOICE) {
		const choice = String(value);
		if (choice === '') return null;
		if (!field.options.some((o) => o.key === choice)) throw writeError('えらべない ものだよ');
		return choice;
	}
	if (field.type === META_TYPE_DURATION) {
		const n = typeof value === 'number' ? value : Number(String(value).trim());
		if (!Number.isFinite(n)) throw writeError('タイムは すうじで いれてね');
		const seconds = Math.trunc(n);
		if (seconds <= 0) return null;
		return Math.min(seconds, META_DURATION_MAX);
	}
	throw writeError('この メモは かけないみたい');
}

export function setMeta(
	db: Db,
	child: string,
	day: DayString,
	itemKey: string,
	updates: Record<string, unknown>
): Record<string, unknown> {
	const today = todayJst();
	const definition = loadDefinition(db, child, today);
	const item = findMetaItem(definition, itemKey);
	if (!item) throw writeError('この こうもくには メモを かけないよ');
	if (!isDay(day)) throw writeError('ひづけが うまく よめなかったよ');
	if (!inPeriod(definition, day)) throw writeError('なつやすみの きかんじゃ ないひだよ');
	if (day > today) throw writeError('まだ さきのひは かけないよ');
	if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
		throw writeError('メモの おくりかたが ちがうみたい');
	}

	const key = checkKey(child, day, itemKey);
	const current = db.daily_checks[key];
	if (!current || current.status !== STATUS_DONE) {
		throw writeError('さきに「やった」にしてから、メモをかいてね');
	}

	const fieldByKey = new Map(item.meta.map((f) => [f.key, f]));
	const merged: Record<string, unknown> = { ...(current.meta ?? {}) };
	for (const [k, value] of Object.entries(updates)) {
		const field = fieldByKey.get(k);
		if (!field) throw writeError('しらない メモの こうもくだよ');
		const normalized = normalizeMetaValue(field, value);
		if (normalized === null) delete merged[k];
		else merged[k] = normalized;
	}
	current.meta = Object.keys(merged).length ? merged : null;
	return merged;
}

// ---- フラグ（一回もの・じゅんび・えらぶ宿題） ----

const findOneShot = (definition: SummerDefinition, itemKey: string): OneShotItem | null =>
	definition.one_shot_homework.find((i) => i.key === itemKey) ?? null;

const oneShotDone = (item: OneShotItem, value: number): boolean =>
	item.type === 'count' ? value >= (item.target || 1) : value >= 1;

function putFlag(db: Db, child: string, itemKey: string, patch: Partial<{ value: number; decision: string | null }>) {
	const key = flagKey(child, itemKey);
	const current = db.flags[key] ?? { value: 0, decision: null, updated_at: 0 };
	db.flags[key] = { ...current, ...patch, updated_at: nowEpochSec() };
	return db.flags[key];
}

export function toggleFlag(db: Db, child: string, itemKey: string) {
	const definition = loadDefinition(db, child, todayJst());
	const oneShot = findOneShot(definition, itemKey);
	if (oneShot && oneShot.type === 'count') throw writeError('この こうもくは かずで かぞえるよ');
	if (!oneShot && !flagItemKeys(definition).has(itemKey)) {
		throw writeError('その こうもくが みつからないよ');
	}
	const state = db.flags[flagKey(child, itemKey)];
	if (state?.decision === DECISION_SKIP) {
		throw writeError(
			'「やらない」にした ものは できたに できないよ（さきに「やる」に もどしてね）'
		);
	}
	const newValue = state && state.value >= 1 ? 0 : 1;
	putFlag(db, child, itemKey, { value: newValue });
	return { value: newValue, done: newValue >= 1 };
}

export function setCount(db: Db, child: string, itemKey: string, value: number) {
	const definition = loadDefinition(db, child, todayJst());
	const item = findOneShot(definition, itemKey);
	if (!item || item.type !== 'count') throw writeError('かずで かぞえる こうもく じゃないよ');
	const clamped = Math.max(0, Math.min(Math.trunc(Number(value) || 0), COUNT_MAX));
	putFlag(db, child, itemKey, { value: clamped });
	return { value: clamped, done: oneShotDone(item, clamped) };
}

export function setDecision(db: Db, child: string, itemKey: string, decision: SummerDecision) {
	const definition = loadDefinition(db, child, todayJst());
	if (decision !== DECISION_DO && decision !== DECISION_SKIP && decision !== null) {
		throw writeError('「やる」か「やらない」を えらんでね');
	}
	const oneShot = findOneShot(definition, itemKey);
	const group =
		definition.choice_homework.find((g) => g.options.some((o) => o.key === itemKey)) ?? null;
	if (oneShot) {
		if (oneShot.required) {
			throw writeError('かならず やる しゅくだいだから「やらない」には できないよ');
		}
	} else if (!group) {
		throw writeError('「やる/やらない」を きめられる こうもく じゃないよ');
	}

	if (group && decision === DECISION_SKIP) {
		const decisions: Record<string, string | null> = {};
		for (const [key, f] of Object.entries(readFlags(db, child))) decisions[key] = f.decision;
		if (!canSkip(group, decisions, itemKey)) {
			throw writeError('どれか1つはえらんでね（ぜんぶ「やらない」にはできないよ）');
		}
	}

	// 「やらない」にしたら、済みの印も消す。ここを decision だけにすると、
	// 画面には「できた」と出たまま「やらない」でもある、という状態が作れてしまう
	// （buildState の done と、えらぶ宿題の satisfied は value から導いているため）。
	// バックエンド側も同じことを1文の UPSERT でやっている（store.set_decision）。
	putFlag(
		db,
		child,
		itemKey,
		decision === DECISION_SKIP ? { decision, value: 0 } : { decision }
	);
	return { decision };
}

// ---- 「きょうやること」 ----

export function todoSpeech(db: Db, child: string, today: DayString) {
	const definition = loadDefinition(db, child, today);
	const statuses = readChecks(db, child, today, today)[today] ?? {};
	const flags = readFlags(db, child);
	const flagValues: Record<string, number> = {};
	const decisions: Record<string, string | null> = {};
	for (const [key, f] of Object.entries(flags)) {
		flagValues[key] = f.value;
		decisions[key] = f.decision;
	}
	const remaining = remainingToday(today, statuses, flagValues, decisions, definition);
	return {
		day: today,
		text: buildTodoSpeechText({
			items: remaining,
			childKana: definition.child_kana,
			gradeLevel: definition.grade_level,
			inPeriod: inPeriod(definition, today),
			awayLabel: awayLabel(definition, today)
		}),
		remaining: remaining.map((r) => ({
			kind: r.kind,
			key: r.key,
			label: r.label,
			note: r.note ?? null
		}))
	};
}

// ---- テレビタイマー ----

/** その子の上限（分）と学年。定義が無い・壊れていてもタイマーは止めたくないので既定に倒す。 */
function mediaRules(db: Db, child: string, today: DayString): [number, number] {
	try {
		const d = loadDefinition(db, child, today);
		return [d.media_timer.limit_minutes, d.grade_level];
	} catch {
		return [MEDIA_LIMIT_MINUTES_DEFAULT, GRADE_MIN];
	}
}

function timerState(db: Db, child: string, today: DayString, now: number) {
	const [limitMinutes, gradeLevel] = mediaRules(db, child, today);
	const row = db.media_timer[timerKey(child, today)];
	const accumulated = row?.accumulated_seconds ?? 0;
	const running = row?.running ?? false;
	const resumedAt = row?.resumed_at ?? null;
	const elapsed = Math.max(0, accumulated + (running && resumedAt !== null ? now - resumedAt : 0));
	const limitSeconds = limitMinutes * 60;
	return {
		child,
		day: today,
		running,
		resumed_at: resumedAt,
		accumulated_seconds: accumulated,
		elapsed_seconds: elapsed,
		// 画面は server_now を基準に毎秒補間する。ここでは端末の時計そのものなので
		// 差はほぼ 0 になるが、形は同じにしておく（画面を書き換えないため）。
		server_now: now,
		limit_seconds: limitSeconds,
		limit_label: mediaLimitLabel(limitMinutes, gradeLevel),
		over_limit: elapsed >= limitSeconds
	};
}

export const mediaTimerState = (db: Db, child: string, today: DayString, now: number) =>
	timerState(db, child, today, now);

export function mediaTimerStart(db: Db, child: string, today: DayString, now: number) {
	const key = timerKey(child, today);
	const row = db.media_timer[key];
	// すでに走っていれば resumed_at を伸ばさない＝二重に押しても増えない
	if (!row) {
		db.media_timer[key] = {
			accumulated_seconds: 0,
			running: true,
			resumed_at: now,
			updated_at: now
		};
	} else if (!row.running) {
		row.running = true;
		row.resumed_at = now;
		row.updated_at = now;
	}
	return timerState(db, child, today, now);
}

export function mediaTimerPause(db: Db, child: string, today: DayString, now: number) {
	const row = db.media_timer[timerKey(child, today)];
	if (row?.running) {
		row.accumulated_seconds += Math.max(0, now - (row.resumed_at ?? now));
		row.running = false;
		row.resumed_at = null;
		row.updated_at = now;
	}
	return timerState(db, child, today, now);
}

// ---- api から呼ぶ薄い包み ----

export const summerApi = {
	summerChildren: () => read((db) => ({ children: listChildren(db, todayJst()) })),
	summerState: (child: string) => read((db) => stateFor(db, child, todayJst())),
	summerSetCheck: (child: string, day: DayString, itemKey: string, status: SummerCheckStatus) =>
		mutate((db) => ({ status: setCheck(db, child, day, itemKey, status) })),
	summerSetMeta: (
		child: string,
		day: DayString,
		itemKey: string,
		meta: Record<string, unknown>
	) => mutate((db) => ({ meta: setMeta(db, child, day, itemKey, meta) as SummerMeta })),
	summerToggleFlag: (child: string, itemKey: string) =>
		mutate((db) => toggleFlag(db, child, itemKey)),
	summerSetCount: (child: string, itemKey: string, value: number) =>
		mutate((db) => setCount(db, child, itemKey, value)),
	summerSetDecision: (child: string, itemKey: string, decision: SummerDecision) =>
		mutate((db) => setDecision(db, child, itemKey, decision)),
	summerTodoSpeech: (child: string) => read((db) => todoSpeech(db, child, todayJst())),
	summerMediaTimerState: (child: string) =>
		read((db) => mediaTimerState(db, child, todayJst(), nowEpochSec())),
	summerMediaTimerStart: (child: string) =>
		mutate((db) => mediaTimerStart(db, child, todayJst(), nowEpochSec())),
	summerMediaTimerPause: (child: string) =>
		mutate((db) => mediaTimerPause(db, child, todayJst(), nowEpochSec()))
};

// 画面 state の組み立て。backend/app/summer/service.py の build_state() の移植。
//
// 保存には触れない。読み出し済みの素のデータ（チェック・メモ・フラグ）を受け取り、
// 画面が描くのに要るもの一式を返す。こうしておくと、バックエンドが実際に返した
// state をそのまま金型として突き合わせられる。
import { diffDays, eachDay, type DayString } from './dates';
import {
	STATUS_DONE,
	awayLabel as awayLabelOf,
	inPeriod,
	type DailyItem,
	type OneShotItem,
	type SummerDefinition
} from './definition';
import {
	CHALLENGE_POINTS,
	dailyScore,
	habitActiveOn,
	inEdgesWindow,
	perfectStreaks,
	remainingToday,
	rewardProgress
} from './judge';
import { buildPraise } from './praise';
import { buildUiText } from './uiText';
// state の形は api の戻り値そのもの。型は $lib/api/types を正とする（型だけの依存）。
import type { SummerState } from '$lib/api/types';

/** 月曜=0。Python の date.weekday() と同じ並び。 */
const WEEKDAYS_JA = ['月', '火', '水', '木', '金', '土', '日'];

export const COUNT_MAX = 99; // カウント型（読書冊数）の上限クランプ
export const META_TEXT_MAX = 100; // text 型メモの最大文字数
export const META_DURATION_MAX = 5999; // duration 型メモの最大秒数（99分59秒）

/** 保存層から渡ってくる形（Python の store.list_* に対応）。 */
export type ChecksByDay = Record<DayString, Record<string, string>>;
export type MetaByDay = Record<DayString, Record<string, Record<string, unknown>>>;
export type FlagState = { value: number; decision: string | null };
export type FlagsByKey = Record<string, FlagState>;

function weekdayJa(day: DayString): string {
	// 1970-01-01 は木曜。UTC で数えているので端末のタイムゾーンに影響されない。
	const index = (((diffDays('1970-01-01', day) + 3) % 7) + 7) % 7;
	return WEEKDAYS_JA[index];
}

const oneShotDone = (item: OneShotItem, value: number): boolean =>
	item.type === 'count' ? value >= (item.target || 1) : value >= 1;

/** 項目のメモ定義（画面が入力欄を描くための型情報）。 */
const metaFieldsOf = (item: DailyItem) =>
	item.meta.map((f) => ({
		key: f.key,
		type: f.type,
		label: f.label,
		placeholder: f.placeholder,
		options: f.options.map((o) => ({ key: o.key, label: o.label }))
	}));

/** 画面の表示状態を一括で組み立てる。 */
export function buildState(args: {
	definition: SummerDefinition;
	today: DayString;
	checks: ChecksByDay;
	metaByDay: MetaByDay;
	flags: FlagsByKey;
}): SummerState {
	const { definition, today, checks, metaByDay, flags } = args;
	const child = definition.child;
	const inPeriodNow = inPeriod(definition, today);

	const todayStatuses = checks[today] ?? {};
	const todayMeta = metaByDay[today] ?? {};
	const flagValues: Record<string, number> = {};
	const decisions: Record<string, string | null> = {};
	for (const [key, f] of Object.entries(flags)) {
		flagValues[key] = f.value;
		decisions[key] = f.decision;
	}

	const habitsOut = definition.habits.map((habit) => ({
		key: habit.key,
		label: habit.label,
		window: habit.window,
		window_start: habit.window_start,
		window_end: habit.window_end,
		cancelable: habit.cancelable,
		window_active: habitActiveOn(habit, today, definition),
		status: todayStatuses[habit.key] ?? null
	}));

	const doneDays = (key: string): number =>
		Object.values(checks).filter((dayChecks) => dayChecks[key] === STATUS_DONE).length;

	const withMeta = (i: DailyItem) => ({
		key: i.key,
		label: i.label,
		status: todayStatuses[i.key] ?? null,
		done_days: doneDays(i.key),
		meta_fields: metaFieldsOf(i),
		meta: todayMeta[i.key] ?? null
	});
	const dailyOut = definition.daily_homework.map(withMeta);

	// スペシャルチャレンジ（宿題で100点をとると解放されるごほうび枠）。done のみの単純トグル。
	const challengesOut = definition.special_challenges.map((c) => ({
		key: c.key,
		label: c.label,
		status: todayStatuses[c.key] ?? null,
		done_days: doneDays(c.key)
	}));

	const oneShotOut = definition.one_shot_homework.map((item) => {
		const value = flagValues[item.key] ?? 0;
		return {
			key: item.key,
			label: item.label,
			type: item.type,
			required: item.required,
			value,
			target: item.target,
			done: oneShotDone(item, value),
			decision: decisions[item.key] ?? null
		};
	});

	const choiceOut = definition.choice_homework.map((group) => {
		const options = group.options.map((o) => ({
			key: o.key,
			label: o.label,
			category: o.category,
			decision: decisions[o.key] ?? null,
			done: (flagValues[o.key] ?? 0) >= 1
		}));
		return {
			key: group.key,
			label: group.label,
			min_required: group.min_required,
			satisfied: options.filter((o) => o.done).length >= group.min_required,
			options
		};
	});

	const schoolStartOut = definition.school_start_items.map((i) => ({
		key: i.key,
		label: i.label,
		due: i.due,
		done: (flagValues[i.key] ?? 0) >= 1
	}));

	// 履歴グリッド: 期間全日（未来日も含む＝グリッドの枠として必要。is_future で描き分ける）
	const nEdges = definition.card_rules.edges_window_days;
	const history: Record<string, unknown>[] = [];
	const streakDays: [number | null, boolean, boolean][] = [];
	const dayTotals: (number | null)[] = [];
	for (const day of eachDay(definition.start, definition.end)) {
		const statuses = checks[day] ?? {};
		const isFuture = day > today;
		const away = awayLabelOf(definition, day);
		// 日別スコア: 未来日と「なにも記録がない日」は null（未記録を0点に潰さない＝グラフは欠測）
		const sb =
			Object.keys(statuses).length && !isFuture ? dailyScore(statuses, day, definition) : null;
		const dayScore = sb ? sb.score : null;
		const dayTotal = sb ? sb.total : null;
		dayTotals.push(dayTotal); // history と同順同長を、同じループで回すことで保証する
		if (!isFuture) streakDays.push([dayScore, Boolean(away), day === today]);
		history.push({
			day,
			weekday: weekdayJa(day),
			statuses,
			meta: metaByDay[day] ?? {},
			away,
			edges_window: inEdgesWindow(day, definition.start, definition.end, nEdges),
			is_future: isFuture,
			is_today: day === today,
			score: dayScore,
			total: dayTotal
		});
	}
	const streaks = perfectStreaks(streakDays);

	const score = inPeriodNow ? dailyScore(todayStatuses, today, definition) : null;
	const remaining = remainingToday(today, todayStatuses, flagValues, decisions, definition);

	const daysTotal = diffDays(definition.start, definition.end) + 1;
	const daysElapsed = Math.min(Math.max(diffDays(definition.start, today) + 1, 0), daysTotal);

	// ご褒美ランク（総積み上げ点数）。定義に rewards が無ければ null＝画面はカード非表示。
	const scoreMax = 100 + CHALLENGE_POINTS * definition.special_challenges.length;
	let rewardsOut: Record<string, unknown> | null = null;
	if (definition.rewards.length) {
		// ペースの分母は今日を除く経過日数（today と start が同日なら 0）
		const daysCompleted = Math.min(Math.max(diffDays(definition.start, today), 0), daysTotal);
		const rp = rewardProgress(dayTotals, daysElapsed, daysCompleted, daysTotal, definition.rewards);
		rewardsOut = {
			total: rp.total,
			cumulative: rp.cumulative,
			ranks: rp.ranks,
			achieved_key: rp.achieved_key,
			pace_key: rp.pace_key,
			projected_total: rp.projected_total,
			max_total: scoreMax * daysTotal // 画面にハードコードさせない
		};
	}

	return {
		child,
		child_kana: definition.child_kana,
		grade: definition.grade,
		grade_level: definition.grade_level,
		// 画面の固定文言。学年ごとに漢字の開き具合だけが変わる（読みは全学年で同じ）。
		// テレビタイマーの {limit} だけはここで実値へ差し替える。
		ui: buildUiText(definition.grade_level, definition.media_timer.limit_minutes),
		today,
		in_period: inPeriodNow,
		period: {
			start: definition.start,
			end: definition.end,
			first_day_of_school: definition.first_day_of_school
		},
		away_today: awayLabelOf(definition, today),
		away: definition.away.map((a) => ({ start: a.start, end: a.end, label: a.label })),
		habits: habitsOut,
		daily_homework: dailyOut,
		special_challenges: challengesOut,
		score_max: scoreMax,
		rewards: rewardsOut,
		one_shot: oneShotOut,
		choice_groups: choiceOut,
		school_start_items: schoolStartOut,
		// 「今日カードにぬる色」を消したあとの互換スタブ。古い画面が guide === null で
		// 期間外を描き分けるので、キーごと消すと undefined が else 枝に落ちて壊れる。
		card_guide: null,
		// 「くりかえしの宿題」を daily_homework へ統合したあとの互換スタブ（同上）。
		// 旧画面は practice を配列として展開するので、キーごと消すと壊れる。
		// docker 版と同じ形を保つ（この state は両版のゴールデンで突き合わせる）。
		practice_homework: [],
		history,
		streaks: {
			perfect_current: streaks.perfect_current,
			perfect_best: streaks.perfect_best,
			perfect_total: streaks.perfect_total
		},
		today_score: score
			? {
					score: score.score, // base(0-100)＝満点花火・ストリークの基準
					bonus: score.bonus,
					total: score.total, // base + ボーナス＝見出し数字・虹色/王冠の基準
					unlocked: score.score === 100, // チャレンジ枠のロック解除条件
					challenge_done: score.challenges.filter((c) => c.done).length,
					challenge_max: score.challenge_max,
					parts: score.parts
				}
			: null,
		remaining_today: remaining.map((r) => ({
			kind: r.kind,
			key: r.key,
			label: r.label,
			note: r.note ?? null
		})),
		// 褒めメッセージ（定型・決定的）。期間外は null＝画面はカード非表示。
		comment: score
			? buildPraise({
					child,
					day: today,
					score,
					hasRecords: Object.keys(todayStatuses).length > 0,
					gradeLevel: definition.grade_level,
					awayLabel: awayLabelOf(definition, today)
				})
			: null,
		progress: { days_elapsed: daysElapsed, days_total: daysTotal }
		// ここで1回だけ型を被せる。中身は定義データ由来の string なので、
		// 'done' | 'not_done' | ... のような絞った型には TypeScript からは届かない。
		// 形が本当に合っているかは state.golden.test.ts が保証している——
		// バックエンドが実際に返した state と、全欄を突き合わせている。
	} as unknown as SummerState;
}

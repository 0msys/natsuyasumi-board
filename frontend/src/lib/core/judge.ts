// 判定・採点。backend/app/summer/judge.py の移植（純関数のみ・保存に触れない）。
//
// - edges 窓: 早寝早起き朝ごはん等の記録欄は はじめ n 日間・おわり n 日間のみ
// - 採点: 100点満点の決定的採点
// - remaining: 「きょうやること」の残り列挙（画面・読み上げで共用）
//
// statuses は {item_key: 'done'|'not_done'|'cancelled'}（キーが無い＝未記入）。
import { addDays, diffDays, dayOfMonth, monthOf, type DayString } from './dates';
import {
	DECISION_SKIP,
	STATUS_CANCELLED,
	STATUS_DONE,
	WINDOW_EDGES,
	WINDOW_RANGE,
	inPeriod,
	type ChoiceGroup,
	type DailyItem,
	type RewardRank,
	type SummerDefinition
} from './definition';

// 採点の配点（合計100）。区分を増やすときは合計100を保つこと：
// 区分の点数は「その区分の項目を全部やった日」にしか満額にならないので、合計が100未満だと
// どんなに頑張っても base==100 に届かず、満点スタンプ・連続満点ストリーク・スペシャル
// チャレンジの加点（base==100 が条件）が永久に発生しなくなる。
export const HABITS_MAX = 50;
export const DAILY_MAX = 50;

/** スペシャルチャレンジ1つあたりの加点（base==100 のときだけ有効）。 */
export const CHALLENGE_POINTS = 25;

/** その定義で1日にとれる最大点（項目数だけで決まる。日付には依存しない）。
 *
 *  dailyScore と同じ組み立て：空の区分は0点固定で、ボーナスは基本点が満点の日にしか
 *  付かない＝片方でも空なら1日50点が上限になる。画面の「全部できたら◯点」・履歴グラフの
 *  y軸・ごほうびグラフの上限・ごほうびの到達判定が、この1つの式を共有する
 *  （別々に書くと、片方だけが空の区分を数え忘れて食い違う）。
 *
 *  記録欄を出す日を絞った習慣まではここでは見ない（その日に出ている項目が0件なら
 *  せいかつは0点になるので、日によってはこの値にも届かない）。上限値として使うこと。 */
export function dayScoreMax(
	habits: number,
	dailyHomework: number,
	specialChallenges: number
): number {
	const base = (habits ? HABITS_MAX : 0) + (dailyHomework ? DAILY_MAX : 0);
	return base + (base === HABITS_MAX + DAILY_MAX ? CHALLENGE_POINTS * specialChallenges : 0);
}

/** 新学期じゅんび項目を「やること」に出し始める due 前日数。 */
export const SCHOOL_START_LEAD_DAYS = 3;
/** 一回もの宿題を「やること」に出し始める夏休み終了前日数。 */
export const ONE_SHOT_LEAD_DAYS = 7;

export type ScorePart = {
	name: string;
	label: string;
	points: number;
	max_points: number;
	done: number;
	total: number;
};
export type ScoreChallenge = { key: string; label: string; done: boolean };
export type ScoreBreakdown = {
	score: number; // base（習慣50+毎日30+反復20）＝満点判定・ストリークの基準
	parts: ScorePart[];
	bonus: number; // チャレンジの加点（base==100 のときのみ、else 0）
	total: number; // base + bonus。表示・履歴グラフの基準
	challenges: ScoreChallenge[];
	challenge_max: number;
	// チャレンジ枠を操作できるか＝毎日の宿題を全部やった（せいかつは見ない）。
	// 加点条件（base==100）とはわざと別物。dailyScore の但し書きを参照。
	unlocked: boolean;
	// base<100 のせいで保留になっている加点額（せいかつを全部やれば入る点）。
	// done にしたチャレンジの件数から出すので、1件も done でなければ0＝画面は何も約束しない。
	// base==100 の日は bonus 側に入っているので0。
	bonus_pending: number;
};
export type RemainingItem = {
	kind: 'habit' | 'daily' | 'one_shot' | 'school_start';
	key: string;
	label: string;
	note?: string | null;
};

/** 四捨五入。JS の Math.round は -0.5 の向きが違うので使わない
 *  （Python 側も組み込み round が偶数丸めで採点が直感とズレるため同じ式を持っている）。 */
export const roundHalfUp = (value: number): number => Math.floor(value + 0.5);

/** はじめ n 日間・おわり n 日間に入っているか。 */
export const inEdgesWindow = (
	day: DayString,
	start: DayString,
	end: DayString,
	n = 5
): boolean =>
	(start <= day && day <= addDays(start, n - 1)) || (addDays(end, -(n - 1)) <= day && day <= end);

/** その習慣にその日 記録欄があるか（window なし=毎日／edges=初終n日／range=指定期間）。 */
export function habitActiveOn(
	habit: DailyItem,
	day: DayString,
	definition: SummerDefinition
): boolean {
	if (habit.window === WINDOW_EDGES) {
		return inEdgesWindow(day, definition.start, definition.end, definition.card_rules.edges_window_days);
	}
	if (habit.window === WINDOW_RANGE) {
		return habit.window_start! <= day && day <= habit.window_end!;
	}
	return true;
}

/** その習慣がその日「加点対象」か。やった＝加点、中止（cancelable のみ）＝満点扱いで加点。 */
const habitCredited = (habit: DailyItem, status: string | undefined): boolean =>
	status === STATUS_DONE || (habit.cancelable && status === STATUS_CANCELLED);

/** その日に記録欄がある習慣。 */
export const habitsDue = (day: DayString, definition: SummerDefinition): DailyItem[] =>
	definition.habits.filter((h) => habitActiveOn(h, day, definition));

/**
 * 選択宿題グループで optionKey を「やらない」にできるか。
 * skip 後に decision != 'skip' の選択肢（未定を含む）が min_required 未満になるなら不可
 * ＝「全部やらない」を作らせない判定の核。
 */
export function canSkip(
	group: ChoiceGroup,
	decisions: Readonly<Record<string, string | null | undefined>>,
	optionKey: string
): boolean {
	const remaining = group.options.filter(
		(o) => (o.key === optionKey ? DECISION_SKIP : decisions[o.key]) !== DECISION_SKIP
	).length;
	return remaining >= group.min_required;
}

/**
 * その日の100点満点採点（決定的）。
 *
 * せいかつ（当日記録欄がある習慣のみ）50点・しゅくだい50点。どちらも
 * 「やった数 ÷ 項目数」で按分する＝宿題は全項目が同じ重み。
 * 未記入と「やらなかった」はどちらも加点なし（区別は表示・音声側で行う）。
 *
 * 区分が空（項目0件）だとその区分は0点＝その子は base==100 に届かなくなる。
 * 片方だけ空の定義を作らせないのは validate の責任。
 *
 * unlocked（チャレンジ枠が開くか）もここで出す。条件は「毎日の宿題を全部やった」だけで、
 * 加点条件の base==100 とは別＝開いていても加点0のことがある。
 */
export function dailyScore(
	statuses: Readonly<Record<string, string>>,
	day: DayString,
	definition: SummerDefinition
): ScoreBreakdown {
	const due = habitsDue(day, definition);
	const habitDone = due.filter((h) => habitCredited(h, statuses[h.key])).length;
	const habitPoints = due.length ? roundHalfUp((HABITS_MAX * habitDone) / due.length) : 0;

	const dailyItemsList = definition.daily_homework;
	const dailyDone = dailyItemsList.filter((i) => statuses[i.key] === STATUS_DONE).length;
	const dailyPoints = dailyItemsList.length
		? roundHalfUp((DAILY_MAX * dailyDone) / dailyItemsList.length)
		: 0;

	// チャレンジ枠の解放条件は「毎日の宿題を全部やった」だけ。せいかつは見ない
	// ＝夜の歯みがきが終わるまで枠が開かない、をやめるため。宿題0件の定義では開かない
	// （開いても加点条件の base==100 に永久に届かない＝押せるのに点が入らない枠になる）。
	const unlocked = dailyItemsList.length > 0 && dailyDone === dailyItemsList.length;

	const parts: ScorePart[] = [
		{
			name: 'habits',
			label: 'せいかつ',
			points: habitPoints,
			max_points: HABITS_MAX,
			done: habitDone,
			total: due.length
		},
		{
			name: 'daily',
			label: 'しゅくだい',
			points: dailyPoints,
			max_points: DAILY_MAX,
			done: dailyDone,
			total: dailyItemsList.length
		}
	];
	const base = parts.reduce((sum, p) => sum + p.points, 0);

	// スペシャルチャレンジ: 枠が開く条件（unlocked＝宿題を全部やった）と、加点の条件は別。
	// 加点は base==100 の日だけ＝せいかつに「やらなかった」や未記入が残った日は、done を
	// 記録してあっても0点。宿題を終えた朝に○を押せて、せいかつを最後まで終えた日にだけ
	// 点が付く、という設計（画面は challenge_bonus_pending でその保留を説明する）。
	const challenges: ScoreChallenge[] = definition.special_challenges.map((c) => ({
		key: c.key,
		label: c.label,
		done: statuses[c.key] === STATUS_DONE
	}));
	const challengeDone = challenges.filter((c) => c.done).length;
	const earned = CHALLENGE_POINTS * challengeDone; // 記録から見た加点額（base を見ない素の値）
	const bonus = base === 100 ? earned : 0;

	return {
		score: base,
		parts,
		bonus,
		total: base + bonus,
		challenges,
		challenge_max: CHALLENGE_POINTS * definition.special_challenges.length,
		unlocked,
		bonus_pending: earned - bonus
	};
}

export type StreakInfo = {
	perfect_current: number; // 今日までの連続満点日数（今日が未達・未記録でもまだ切らない）
	perfect_best: number; // 期間内の最長
	perfect_total: number; // 満点日の合計（集めたスタンプの数）
};

/**
 * 連続満点ストリークの集計（期間開始→今日の (score, away, is_today) 列。未来日は渡さない）。
 *
 * - score==100 は加算（おでかけ日でも満点なら数える）
 * - おでかけ日・今日の 100 未満/未記録は「透明」＝切らず数えず
 *   （おでかけを責めない・今日はまだ途中で夕方に切れて見せない）
 * - それ以外の過去日の 100 未満/未記録は切断（過去日修正で直せば「つながる」）
 */
export function perfectStreaks(
	days: readonly (readonly [number | null, boolean, boolean])[]
): StreakInfo {
	let current = 0;
	let best = 0;
	let total = 0;
	for (const [score, away, isToday] of days) {
		if (score === 100) {
			current++;
			total++;
			best = Math.max(best, current);
		} else if (away || isToday) {
			continue;
		} else {
			current = 0;
		}
	}
	return { perfect_current: current, perfect_best: best, perfect_total: total };
}

export type RewardRankState = {
	key: string;
	label: string;
	avg: number;
	threshold: number; // 到達に必要な総積み上げ点数（avg × days_total）
	prize: string | null;
	achieved: boolean;
};
export type RewardProgress = {
	total: number;
	cumulative: (number | null)[];
	ranks: RewardRankState[];
	achieved_key: string | null;
	pace_key: string | null;
	projected_total: number;
};

/**
 * 総積み上げ点数によるご褒美ランクの進捗（決定的・純関数）。
 *
 * dayTotals は history と同順同長（期間全日・未来/未記録は null）。
 * daysRecordedUntil=今日を含む経過日数（この位置まで cumulative を出す）、
 * daysCompleted=今日を除く完了日数（ペースの分母）。
 */
export function rewardProgress(
	dayTotals: readonly (number | null)[],
	daysRecordedUntil: number,
	daysCompleted: number,
	daysTotal: number,
	ranks: readonly RewardRank[]
): RewardProgress {
	let running = 0;
	let completedSum = 0;
	const cumulative: (number | null)[] = [];
	for (const [i, dt] of dayTotals.entries()) {
		if (i < daysRecordedUntil) {
			// 未記録日は0加算で前日値キャリーフォワード（積み上げ線にギャップを作らない）
			running += dt ?? 0;
			cumulative.push(running);
		} else {
			cumulative.push(null); // 今日より先＝まだ点が無い
		}
		if (i < daysCompleted) completedSum += dt ?? 0;
	}
	const total = running;

	const rankStates: RewardRankState[] = [];
	let achievedKey: string | null = null;
	for (const r of ranks) {
		const threshold = r.avg * daysTotal;
		const achieved = total >= threshold;
		if (achieved) achievedKey = r.key; // ranks は avg 昇順＝上書きで最大達成ランクが残る
		rankStates.push({
			key: r.key,
			label: r.label,
			avg: r.avg,
			threshold,
			prize: r.prize,
			achieved
		});
	}

	// ペースは今日を除外して安定化（朝の未記録で暴落しない・ストリークの「今日は透明」と同思想）
	const projectedTotal =
		daysCompleted <= 0 ? 0 : roundHalfUp((completedSum / daysCompleted) * daysTotal);
	let paceKey: string | null = null;
	for (const r of ranks) {
		if (projectedTotal >= r.avg * daysTotal) paceKey = r.key; // 同じく昇順＝到達見込みの最大
	}

	return {
		total,
		cumulative,
		ranks: rankStates,
		achieved_key: achievedKey,
		pace_key: paceKey,
		projected_total: projectedTotal
	};
}

/**
 * 「きょうやること」の残り（未記入の習慣・宿題、間近の新学期じゅんび）。
 *
 * 3値のうち「やらなかった」は記録済み＝消し込み済みとして残りに含めない。
 * 夏休み期間外でも新学期じゅんびは due ベースで出す。
 */
export function remainingToday(
	day: DayString,
	statuses: Readonly<Record<string, string>>,
	flagValues: Readonly<Record<string, number>>,
	decisions: Readonly<Record<string, string | null | undefined>>,
	definition: SummerDefinition
): RemainingItem[] {
	const items: RemainingItem[] = [];

	if (inPeriod(definition, day)) {
		for (const habit of habitsDue(day, definition)) {
			if (!(habit.key in statuses)) {
				items.push({ kind: 'habit', key: habit.key, label: habit.label, note: 'きろくしよう' });
			}
		}
		for (const hw of definition.daily_homework) {
			if (!(hw.key in statuses)) items.push({ kind: 'daily', key: hw.key, label: hw.label });
		}
		// 夏休みの終わりが近づいたら、終わっていない一回もの宿題も出す
		if (diffDays(day, definition.end) <= ONE_SHOT_LEAD_DAYS) {
			for (const item of definition.one_shot_homework) {
				if (decisions[item.key] === DECISION_SKIP) continue;
				const value = flagValues[item.key] ?? 0;
				if (item.type === 'count') {
					const target = item.target || 1;
					if (value < target) {
						items.push({
							kind: 'one_shot',
							key: item.key,
							label: item.label,
							note: `あと${target - value}`
						});
					}
				} else if (value < 1) {
					items.push({ kind: 'one_shot', key: item.key, label: item.label });
				}
			}
			// えらぶ宿題は「どれか min_required 個以上」なので、件数で見る。
			// 1つでも done なら消す書きかたにすると、2つ必要な設定で1つ終えた時点で
			// 残りから消え、宿題カード（satisfied）と言うことが食い違う。
			for (const group of definition.choice_homework) {
				const done = group.options.filter((o) => (flagValues[o.key] ?? 0) >= 1).length;
				if (done < group.min_required) {
					items.push({
						kind: 'one_shot',
						key: group.key,
						label: group.label,
						note: `あと${group.min_required - done}`
					});
				}
			}
		}
	}

	for (const prep of definition.school_start_items) {
		if ((flagValues[prep.key] ?? 0) >= 1) continue;
		if (diffDays(day, prep.due) <= SCHOOL_START_LEAD_DAYS) {
			items.push({
				kind: 'school_start',
				key: prep.key,
				label: prep.label,
				note: `${monthOf(prep.due)}/${dayOfMonth(prep.due)}まで`
			});
		}
	}

	return items;
}

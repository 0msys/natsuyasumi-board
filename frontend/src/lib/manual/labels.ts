// 子どもページに出ているボタン名・見出しを、マニュアル本文から引くための表。
//
// これらの文言は backend/app/summer/ui_text.py が持ち、生成物
// $lib/core/generated/uiTextSource.ts に落ちてくる。マニュアルへ手で写すと、
// ui_text.py を直した瞬間に黙ってズレる（実際この表を作る前の下書きは
// 「さいかい」＝実物は「さいかい（またつけた）」、「ごほうびひょう」＝実物は
// 「ごほうびランク」と、2箇所すでにズレていた）。生成物から引けばズレようがない。
//
// stripRubyMarkup を使う（stripRuby ではない）。両者は向きが逆で、
//   stripRubyMarkup: 今日《きょう》のチェック → 今日のチェック  ← 親向けはこちら
//   stripRuby:       今日《きょう》のチェック → きょうのチェック  ← 読み上げ・aria 用
// マニュアルの読み手は親なので漢字のまま出す。
//
// なお子どもの画面では学年に応じて漢字がひらがなに開くので、実際の表示は
// ここより かな寄り になることがある。その断りは OverviewSection が本文で入れている。
import { UI_TEXT_SOURCE } from '$lib/core/generated/uiTextSource';
import { stripRubyMarkup } from '$lib/core/ruby';

const of = (key: string): string => stripRubyMarkup(UI_TEXT_SOURCE[key] ?? '');

/** 画面にそのまま出ている文字（{…} の差し込みが無いキーだけを置く）。 */
export const SCREEN = {
	todayChecks: of('today_checks_title'),
	sectionHabits: of('section_habits'),
	sectionDaily: of('section_daily'),
	checkDone: of('check_done'),
	checkNotDone: of('check_not_done'),
	checkCancelled: of('check_cancelled'),
	todoSpeechAsk: of('todo_speech_ask'),
	commentTitle: of('comment_title'),
	listen: of('listen_aria'),
	challengeTitle: of('challenge_title'),
	challengeBonus: of('challenge_bonus'),
	challengeBonusPending: of('challenge_bonus_pending'),
	challengeLocked: of('challenge_locked_overlay'),
	homeworkTitle: of('homework_title'),
	homeworkOptional: of('homework_optional'),
	homeworkDoneDays: of('homework_done_days_title'),
	decideDo: of('decide_do'),
	decideSkip: of('decide_skip'),
	schoolStartTitle: of('school_start_title'),
	rewardTitle: of('reward_title'),
	rewardHint: of('reward_hint'),
	historyTitle: of('history_title'),
	dayEditButton: of('day_edit_button'),
	dayEditViewOnly: of('day_edit_view_only'),
	close: of('close'),
	timerTitle: of('timer_title'),
	timerStart: of('timer_start'),
	timerStop: of('timer_stop'),
	timerResume: of('timer_resume'),
	timerWatchedToday: of('timer_watched_today'),
	stopwatchLabel: of('stopwatch_label'),
	stopwatchStart: of('stopwatch_start'),
	stopwatchStop: of('stopwatch_stop'),
	celebrationTitle: of('celebration_title')
} as const;

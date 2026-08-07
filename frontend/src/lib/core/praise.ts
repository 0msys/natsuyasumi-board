// 「きょうのがんばり」定型メッセージ。backend/app/summer/praise.py の移植。
//
// スコアは judge の決定的採点が正。メッセージはスコア帯×学年帯の定型バンクから選ぶ。
// 同じ子・同じ日なら常に同じ文（リロードで変わらない）、日が変わればバリアントが回る——
// 選択は crc32 による安定ハッシュ（乱数を使うと「さっきと違う文が出た」になる）。
//
// 方針: できたことをほめる・できなかったことを責めない・やっていないスペシャル
// チャレンジには一切ふれない（非対称原則）。
import { crc32 } from './crc32';
import { gradeBand, openForGrade } from './kanji';
import { AWAY_LINE, CHALLENGE_LINE, PRAISE_MESSAGES, SCORE_LINE } from './generated/praiseBank';
import type { ScoreBreakdown } from './judge';
import type { DayString } from './dates';

// スコア帯（上から順に判定）
export const BAND_PERFECT_PLUS = 'perfect_plus'; // base 100 ＋ チャレンジボーナスあり
export const BAND_PERFECT = 'perfect'; // base 100
export const BAND_GREAT = 'great'; // 80 以上
export const BAND_GOOD = 'good'; // 50 以上
export const BAND_KEEP_GOING = 'keep_going'; // 50 未満（記録はある）
export const BAND_NOT_YET = 'not_yet'; // きょうの記録がまだ1件もない

export type Praise = {
	score: number;
	bonus: number;
	total: number;
	band: string;
	text: string;
};

/** スコア帯の判定（not_yet はきょうの記録が1件もないとき）。 */
export function scoreBand(score: ScoreBreakdown, hasRecords: boolean): string {
	if (!hasRecords) return BAND_NOT_YET;
	if (score.score === 100) return score.bonus > 0 ? BAND_PERFECT_PLUS : BAND_PERFECT;
	if (score.score >= 80) return BAND_GREAT;
	if (score.score >= 50) return BAND_GOOD;
	return BAND_KEEP_GOING;
}

/** 同じ子・同じ日なら同じ文になる安定選択（日が変わればバリアントが回る）。 */
const pick = (variants: readonly string[], child: string, day: DayString): string =>
	variants[crc32(`${child}|${day}`) % variants.length];

const fill = (template: string, values: Record<string, string | number>): string =>
	template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in values ? String(values[name]) : whole
	);

/** その日の褒めメッセージを組み立てる（決定的）。 */
export function buildPraise(args: {
	child: string;
	day: DayString;
	score: ScoreBreakdown;
	hasRecords: boolean;
	gradeLevel: number;
	awayLabel: string | null;
}): Praise {
	const { child, day, score, hasRecords, gradeLevel, awayLabel } = args;
	const gband = gradeBand(gradeLevel);
	const sband = scoreBand(score, hasRecords);
	const parts: string[] = [];
	if (sband !== BAND_NOT_YET) parts.push(fill(SCORE_LINE[gband], { score: score.score }));
	parts.push(pick(PRAISE_MESSAGES[gband][sband], child, day));
	if (sband === BAND_PERFECT_PLUS) {
		parts.push(fill(CHALLENGE_LINE[gband], { bonus: score.bonus, total: score.total }));
	}
	if (awayLabel) parts.push(AWAY_LINE[gband]);
	// 口調は3帯のまま、漢字の開き具合だけ子どもの学年に合わせる（読みは変わらない）
	return {
		score: score.score,
		bonus: score.bonus,
		total: score.total,
		band: sband,
		text: openForGrade(parts.join(''), gradeLevel)
	};
}

// 子ども向け画面の固定文言。backend/app/summer/ui_text.py の移植。
//
// 文言は「最大漢字＋総ルビ」で1回だけ書き（generated/uiTextSource.ts）、学年ごとの表示は
// openForGrade() が導く。だから配当外の漢字は構成上いっさい画面に出ないし、どの学年でも
// 「読み」は同じ＝ aria-label / title / 読み上げは学年によらず同一になる。
import { openForGrade } from './kanji';
import { UI_SHOW_FROM, UI_TEXT_SOURCE } from './generated/uiTextSource';

/**
 * その学年で表示する固定文言一式。
 *
 * mediaLimitMinutes を渡すと、テレビタイマーの文言に残る {limit} をここで実値へ差し替える。
 * 省略すると記法のまま返す（スナップショットの照合はこちら）。
 */
export function buildUiText(
	gradeLevel: number,
	mediaLimitMinutes?: number | null
): Record<string, string> {
	const texts: Record<string, string> = {};
	for (const [key, text] of Object.entries(UI_TEXT_SOURCE)) {
		texts[key] = openForGrade(text, gradeLevel, { showFrom: UI_SHOW_FROM });
	}
	if (mediaLimitMinutes !== undefined && mediaLimitMinutes !== null) {
		const limit = mediaLimitLabel(mediaLimitMinutes, gradeLevel);
		for (const key of Object.keys(texts)) texts[key] = texts[key].replaceAll('{limit}', limit);
	}
	return texts;
}

// 「分」の助数詞の音便。1の位が 1/3/4/6/8 と、10の倍数（20分＝にじゅっぷん）は「ぷん」。
// 総ルビなので読みは実際に画面へ出るし、小1では漢字ごと かな へ畳まれて本文になる
// （間違えると「30ふん」と書かれてしまう）。プリセットの 30分・90分がそのまま該当する。
const PUN_ONES = new Set([1, 3, 4, 6, 8]);

/** その分数の「分」の読み（ぷん／ふん）。 */
function minutesYomi(mins: number): string {
	const ones = mins % 10;
	if (PUN_ONES.has(ones) || (ones === 0 && mins > 0)) return 'ぷん';
	return 'ふん';
}

/**
 * 視聴タイマーの上限（分）を、その学年で読める表記にする（例「2時間《じかん》30分《ぷん》」）。
 *
 * 上限は子どもごとに変えられるので、固定文言のように1本書いておけない。ルビ記法で
 * 組んでから同じ openForGrade に通す＝配当外の漢字は出ず、読みは全学年で同じになる。
 */
export function mediaLimitLabel(minutes: number, gradeLevel: number): string {
	const total = Math.max(0, Math.trunc(minutes));
	const hours = Math.floor(total / 60);
	const mins = total % 60;
	const parts: string[] = [];
	if (hours) parts.push(`${hours}時間《じかん》`);
	if (mins || !hours) parts.push(`${mins}分《${minutesYomi(mins)}》`);
	return openForGrade(parts.join(''), gradeLevel, { showFrom: UI_SHOW_FROM });
}

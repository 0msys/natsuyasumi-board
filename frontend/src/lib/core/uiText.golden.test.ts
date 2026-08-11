// 画面の固定文言（約100本 × 6学年）と、視聴上限の表記を突き合わせる。
import { buildUiText, mediaLimitLabel } from './uiText';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('uiText.json');

type Input =
	| { kind: 'uiText'; grade: number; mediaLimitMinutes?: number; scoreMax?: number }
	| { kind: 'mediaLimit'; minutes: number; grade: number };

runGolden(golden as unknown as GoldenFile<Input, unknown>, '固定文言', (input) =>
	input.kind === 'uiText'
		? buildUiText(input.grade, input.mediaLimitMinutes, input.scoreMax)
		: mediaLimitLabel(input.minutes, input.grade)
);

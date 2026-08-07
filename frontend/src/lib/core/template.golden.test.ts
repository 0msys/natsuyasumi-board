// 初回ウィザードのテンプレートを突き合わせる（学年で変わるのは文言だけ、が守れているか）。
import { TEMPLATES } from './template';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('template.json');
import type { Period } from './template';

type Input = {
	kind: 'standard' | 'empty';
	child: string;
	childKana: string;
	grade: string;
	year: number;
	period: Period;
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, 'テンプレート', (input) =>
	TEMPLATES[input.kind](input.child, input.childKana, input.grade, input.year, input.period)
);

// 初回ウィザードのテンプレートを突き合わせる（学年で変わるのは文言だけ、が守れているか）。
import { expect, test } from 'bun:test';
import { TEMPLATES } from './template';
import { CHALLENGE_POINTS } from './judge';
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

type Output = {
	special_challenges?: unknown[];
	rewards?: { key: string; avg: number }[];
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, 'テンプレート', (input) =>
	TEMPLATES[input.kind](input.child, input.childKana, input.grade, input.year, input.period)
);

// ごほうびの avg が1日の上限（100 + チャレンジ数 × 25）を超えると、夏休み中1日も欠かさず
// 全部やっても届かないランクになる（issue #28。グラフからも帯が消える）。値を直すだけだと
// あとでチャレンジ数を変えたときに同じ穴があくので、関係のほうを固定する。
// 見るのは金型の output＝バックエンドが実際に作った定義（TS だけ直した取りこぼしも拾う）。
test('テンプレートのごほうびは、1日の上限で届く', () => {
	const over: string[] = [];
	for (const c of (golden as unknown as GoldenFile<Input, Output>).cases) {
		const scoreMax = 100 + CHALLENGE_POINTS * (c.output.special_challenges?.length ?? 0);
		for (const r of c.output.rewards ?? []) {
			if (r.avg > scoreMax) over.push(`${c.name} ${r.key}: avg=${r.avg} > 1日の上限${scoreMax}`);
		}
	}
	expect(over, '全日満点でも届かないランクがテンプレートに入っている:\n  ' + over.join('\n  ')).toEqual(
		[]
	);
});

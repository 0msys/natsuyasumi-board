// 「いま画面に出す年」の選びかたを突き合わせる。
// ここを間違えると、夏の最中に来年ぶんを作った瞬間に子どもの画面が来年に飛ぶ。
import { periodBounds, selectDefinitionYear } from './definition';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('selectYear.json');

type Input =
	| { kind?: undefined; candidates: [number, [string, string] | null][]; today: string }
	| { kind: 'periodBounds'; doc: unknown };

runGolden(golden as unknown as GoldenFile<Input, unknown>, '出す年の選択', (input) =>
	input.kind === 'periodBounds'
		? periodBounds(input.doc)
		: selectDefinitionYear(input.candidates, input.today)
);

// 「きょうやること」読み上げ文の組み立てを突き合わせる。
import { buildTodoSpeechText } from './speech';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('speech.json');
import type { RemainingItem } from './judge';

type Input = {
	items: RemainingItem[];
	childKana: string;
	gradeLevel: number;
	inPeriod: boolean;
	awayLabel: string | null;
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, '読み上げ文', (input) =>
	buildTodoSpeechText(input)
);

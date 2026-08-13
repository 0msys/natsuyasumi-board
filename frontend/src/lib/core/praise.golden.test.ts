// 褒めメッセージ（スコア帯×学年帯×おでかけ）を突き合わせる。
// crc32 が1ビットでもずれると、画面は動くのに別のバリアントが選ばれるので、
// ここが実質 crc32 の検査も兼ねている。
import { buildPraise } from './praise';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('praise.json');
import type { ScoreBreakdown } from './judge';

type Input = {
	child: string;
	day: string;
	score: { score: number; bonus: number; total: number };
	hasRecords: boolean;
	gradeLevel: number;
	awayLabel: string | null;
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, '褒めメッセージ', (input) =>
	buildPraise({
		child: input.child,
		day: input.day,
		// build_praise が採点結果から見るのは score / bonus / total だけ
		score: {
			...input.score,
			parts: [],
			challenges: [],
			challenge_max: 0,
			unlocked: false
		} as ScoreBreakdown,
		hasRecords: input.hasRecords,
		gradeLevel: input.gradeLevel,
		awayLabel: input.awayLabel
	})
);

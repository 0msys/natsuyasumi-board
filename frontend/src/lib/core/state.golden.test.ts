// 画面 state の一括組み立てを、バックエンドが実際に返した state と丸ごと突き合わせる。
//
// ここが通れば、採点・履歴・ストリーク・ごほうび進捗・褒め文・やること残り・固定文言が
// まとめて一致していることになる（/api/summer/state の戻りそのものなので）。
import { parseDefinition } from './definition';
import { buildState, type ChecksByDay, type FlagsByKey, type MetaByDay } from './state';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('state.json');

type Input = {
	doc: unknown;
	today: string;
	checks: ChecksByDay;
	metaByDay: MetaByDay;
	flags: FlagsByKey;
};

runGolden(golden as unknown as GoldenFile<Input, unknown>, '画面 state', (input) =>
	buildState({
		definition: parseDefinition(input.doc),
		today: input.today,
		checks: input.checks,
		metaByDay: input.metaByDay,
		flags: input.flags
	})
);

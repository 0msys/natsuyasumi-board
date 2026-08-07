// 採点まわりの移植を突き合わせる。
// いちばん危ないのは丸めで、バックエンドは int(v+0.5)（＝切り捨て寄せ）を自前で持っている。
// JS の Math.round に置き換えると、50*1/4=12.5 のような境目だけ静かに1点ずれる。
import { parseDefinition } from './definition';
import {
	canSkip,
	dailyScore,
	habitsDue,
	perfectStreaks,
	remainingToday,
	rewardProgress
} from './judge';
import { runGolden, loadGolden, loadSampleDoc, type GoldenFile } from './golden';
const golden = loadGolden('judge.json');
const sampleDoc = loadSampleDoc();

const definition = parseDefinition(sampleDoc);

type Input =
	| { kind: 'dailyScore'; statuses: Record<string, string>; day: string }
	| { kind: 'habitsDue'; day: string }
	| { kind: 'perfectStreaks'; days: [number | null, boolean, boolean][] }
	| {
			kind: 'rewardProgress';
			dayTotals: (number | null)[];
			daysRecordedUntil: number;
			daysCompleted: number;
			daysTotal: number;
	  }
	| {
			kind: 'remainingToday';
			day: string;
			statuses: Record<string, string>;
			flagValues: Record<string, number>;
			decisions: Record<string, string | null>;
	  }
	| {
			kind: 'canSkip';
			groupKey: string;
			decisions: Record<string, string | null>;
			optionKey: string;
	  };

runGolden(golden as unknown as GoldenFile<Input, unknown>, '採点', (input) => {
	switch (input.kind) {
		case 'dailyScore':
			return dailyScore(input.statuses, input.day, definition);
		case 'habitsDue':
			return habitsDue(input.day, definition).map((h) => h.key);
		case 'perfectStreaks':
			return perfectStreaks(input.days);
		case 'rewardProgress':
			return rewardProgress(
				input.dayTotals,
				input.daysRecordedUntil,
				input.daysCompleted,
				input.daysTotal,
				definition.rewards
			);
		case 'remainingToday':
			return remainingToday(
				input.day,
				input.statuses,
				input.flagValues,
				input.decisions,
				definition
			).map((i) => ({ kind: i.kind, key: i.key, label: i.label, note: i.note ?? null }));
		case 'canSkip': {
			const group = definition.choice_homework.find((g) => g.key === input.groupKey)!;
			return canSkip(group, input.decisions, input.optionKey);
		}
	}
});

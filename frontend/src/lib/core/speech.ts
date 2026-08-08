// 「きょうやること」読み上げテキストの決定的組み立て。
// backend/app/summer/speech.py の移植。
//
// judge.remainingToday の残り一覧を、子どもに語りかける短い文に整形する。
// 画面にも同じテキストを表示する（音声と画面の内容ズレを作らない）。
//
// lite 版に読み上げ機能そのものは無いが、この文は画面の「きょうやること」でも
// 使うので残す（api の contract も欠かさない）。
import { openForGrade } from './kanji';
import { SPEECH_LINES, SPEECH_LIST_MAX } from './generated/speechLines';
import type { RemainingItem } from './judge';

const fill = (template: string, values: Record<string, string>): string =>
	template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in values ? values[name] : whole
	);

function joinLabels(items: readonly RemainingItem[], grade: number): string {
	const labels = items.slice(0, SPEECH_LIST_MAX).map((i) => i.label);
	let joined = labels.join('と、');
	if (items.length > SPEECH_LIST_MAX) joined += openForGrade(SPEECH_LINES.more, grade);
	return joined;
}

/** やること残りの読み上げ文（決定的テンプレート）。 */
export function buildTodoSpeechText(args: {
	items: readonly RemainingItem[];
	childKana: string;
	gradeLevel: number;
	inPeriod: boolean;
	awayLabel: string | null;
}): string {
	const { items, childKana, gradeLevel: grade, inPeriod, awayLabel } = args;

	/** 定型文をその学年ぶんだけ開いてから差し込む。 */
	const line = (key: string, values: Record<string, string> = {}): string =>
		fill(openForGrade(SPEECH_LINES[key], grade), values);

	const sentences: string[] = [`${childKana}さん。`];

	const habitDaily = items.filter((i) => i.kind === 'habit' || i.kind === 'daily');
	const oneShot = items.filter((i) => i.kind === 'one_shot');
	const prep = items.filter((i) => i.kind === 'school_start');

	if (awayLabel && inPeriod) sentences.push(line('away'));

	if (!habitDaily.length && !oneShot.length) {
		if (inPeriod) sentences.push(line('all_done'));
	} else {
		if (habitDaily.length) sentences.push(line('habit_daily', { labels: joinLabels(habitDaily, grade) }));
		if (oneShot.length) sentences.push(line('one_shot', { labels: joinLabels(oneShot, grade) }));
	}

	for (const item of prep) {
		const note = item.note ? `（${item.note}）` : '';
		sentences.push(line('prep', { label: item.label, note }));
	}

	return sentences.join('');
}

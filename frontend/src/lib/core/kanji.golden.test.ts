// 漢字まわりの移植を、バックエンドの出力と突き合わせる。
import { expect, test } from 'bun:test';
import { GRADE_KANJI, openForGrade, validateRubySource } from './kanji';
import { GRADE_KANJI_COUNTS, GRADE_KANJI_SOURCE } from './generated/kanjiTable';
import { runGolden, loadGolden, type GoldenFile } from './golden';
const golden = loadGolden('kanji.json');

type Input =
	| { kind: 'counts' }
	| { kind: 'open'; text: string; grade: number }
	| { kind: 'validate'; text: string };

runGolden(
	golden as unknown as GoldenFile<Input, unknown>,
	'漢字',
	(input) => {
		if (input.kind === 'counts') return [1, 2, 3, 4, 5, 6].map((g) => GRADE_KANJI.get(g)!.size);
		if (input.kind === 'open') return openForGrade(input.text, input.grade);
		return validateRubySource(input.text);
	},
	// validateRubySource が返すのは開発者向けの lint 文言で、値そのものではない。
	// Python 側は repr（'…'）、こちらは JSON（"…"）で引用符が違うだけなので、
	// 文言を Python に寄せるのではなく「どの規則が、どの順で鳴ったか」を比べる。
	(value, input) =>
		input.kind === 'validate'
			? (value as string[]).map((message) => message.split(':')[0])
			: value
);

// 配当表そのものの錠。学年ごとの字数が合っていれば、写し取りで1字落ちた・重複した、が出る。
test('配当漢字は 80/160/200/202/193/191 の計1,026字', () => {
	expect([...GRADE_KANJI_SOURCE].map((s) => [...s].length)).toEqual([...GRADE_KANJI_COUNTS]);
	expect([...GRADE_KANJI_COUNTS]).toEqual([80, 160, 200, 202, 193, 191]);
	expect(GRADE_KANJI_COUNTS.reduce((a, b) => a + b, 0)).toBe(1026);
});

test('同じ字が2つの学年に入っていない', () => {
	const seen = new Map<string, number>();
	const dupes: string[] = [];
	for (const [grade, chars] of GRADE_KANJI) {
		for (const ch of chars) {
			if (seen.has(ch)) dupes.push(`${ch}（小${seen.get(ch)} と 小${grade}）`);
			else seen.set(ch, grade);
		}
	}
	expect(dupes).toEqual([]);
	expect(seen.size).toBe(1026);
});

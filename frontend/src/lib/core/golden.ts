// 金型（golden）テストの共通部分。
//
// 金型は backend/tools/dump_golden.py が「バックエンドに実際に入れた値」と
// 「バックエンドが実際に返した値」の対で書き出したもの。TS 側は input を食わせて
// output と比べる＝移植のズレがそのまま落ちる。
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

export type GoldenCase<I = unknown, O = unknown> = { name: string; input: I; output: O };
export type GoldenFile<I = unknown, O = unknown> = {
	_note: string;
	about: string;
	cases: GoldenCase<I, O>[];
};

/** 金型を読む。
 *
 *  import 文で読み込まないのは、TypeScript が JSON の中身を丸ごとリテラル型として
 *  推論しにいくため。数千件の金型でそれをやると svelte-check がヒープを使い切って落ちる
 *  （実際に落とした）。実行時に読めば型検査の対象から外れる。 */
export function loadGolden<I = unknown, O = unknown>(name: string): GoldenFile<I, O> {
	const path = new URL(`./__golden__/${name}`, import.meta.url);
	return JSON.parse(readFileSync(path, 'utf8')) as GoldenFile<I, O>;
}

/** サンプル定義（docs/examples/2026-はな.json の写し）を1件ぶん読む。 */
export const loadSampleDoc = (): Record<string, unknown> =>
	JSON.parse(
		readFileSync(new URL('./__golden__/sampleDoc.json', import.meta.url), 'utf8')
	) as Record<string, unknown>;

/** 敵対的スイープの1操作。金型には定義全文ではなくこれが入っている
 *  （全文を焼き込むと 2,000 件で数十MBになる）。 */
export type Mutation = {
	path: (string | number)[];
	op: 'set' | 'delete';
	value?: unknown;
};

/** サンプル定義に操作を1つ当てた doc を作る（元は壊さない）。 */
export function applyMutation(base: unknown, mutation: Mutation | null | undefined): unknown {
	const doc = JSON.parse(JSON.stringify(base));
	if (!mutation) return doc;
	let parent = doc as Record<string | number, unknown>;
	for (const step of mutation.path.slice(0, -1)) {
		parent = parent[step] as Record<string | number, unknown>;
	}
	const last = mutation.path[mutation.path.length - 1];
	if (mutation.op === 'delete') {
		if (Array.isArray(parent)) (parent as unknown[]).splice(Number(last), 1);
		else delete parent[last];
	} else {
		parent[last] = mutation.value;
	}
	return doc;
}

/**
 * 金型1ファイルを回す。
 *
 * 件数が数千になるので、1件1テストにはしない（bun test の出力が読めなくなる）。
 * 代わりに最初の食い違いだけを、どのケースかが分かる形で報告する。
 */
export function runGolden<I, O>(
	file: GoldenFile<I, O>,
	label: string,
	compute: (input: I) => unknown,
	// 比べる前に両側へ通す整形。人向けのエラー文言のように「Python の書きかたに
	// 合わせる意味がない」部分を、比較の対象から外すために使う。
	normalize: (value: unknown, input: I) => unknown = (v) => v
): void {
	test(`${label}（金型 ${file.cases.length} 件）`, () => {
		const failures: string[] = [];
		for (const c of file.cases) {
			let actual: unknown;
			try {
				actual = normalize(compute(c.input), c.input);
			} catch (e) {
				failures.push(`${c.name}: 例外 ${e instanceof Error ? e.message : String(e)}`);
				continue;
			}
			// JSON 経由で比べる（undefined と欠落、Map/Set の差を持ち込まない）
			const a = JSON.stringify(actual);
			const b = JSON.stringify(normalize(c.output, c.input));
			if (a !== b) {
				failures.push(`${c.name}\n    バックエンド: ${b}\n    こちら:       ${a}`);
			}
			if (failures.length >= 5) break; // 全部出すと読めないので先頭だけ
		}
		expect(
			failures,
			`${label} が金型と食い違っています（先頭 ${failures.length} 件）:\n  ` +
				failures.join('\n  ') +
				'\n金型を作り直す: cd backend && uv run python tools/dump_golden.py'
		).toEqual([]);
	});
}

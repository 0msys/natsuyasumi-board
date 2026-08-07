// 内部リンクの番人。
//
// lite（GitHub Pages）はリポジトリ名のサブパス /natsuyasumi-board/ で配信されるので、
// `href="/admin"` のような絶対パスは base を含まず、別のサイトの入口を指してしまう。
//
// この壊れ方は静かなのが厄介で、<body data-sveltekit-preload-data="hover"> があるため
// SvelteKit は base 外のパスを「外部リンク」とみなす。クライアント遷移が起きないだけで
// JS エラーも出ず、押すと GitHub の 404 ページへフルページ遷移する。
//
// なので内部リンクは必ず $app/paths の resolve() を通す。ここではその抜けを機械で拾う。
import { expect, test } from 'bun:test';
import { Glob } from 'bun';

// `href="/…"` / `href={'/…'}` / `href={`/…`}` / goto('/…') / redirect(307, '/…')
const OFFENDERS: { why: string; re: RegExp }[] = [
	{ why: 'href に絶対パスを直接書いている', re: /href=(?:"\/|'\/|\{\s*['"`]\/)/g },
	{ why: 'goto() に絶対パスを渡している', re: /goto\(\s*['"`]\//g },
	{ why: 'redirect() に絶対パスを渡している', re: /redirect\(\s*\d+\s*,\s*['"`]\//g }
];

// このファイル自身は上のパターンを「文字列として」持っているので対象外にする。
const SELF = 'src/routes/links.test.ts';

// コメント行は見ない。「かつては href="/api/..." と書いていた」という由来の説明まで
// 咎めると、直した理由を書けなくなる。
const COMMENT = /^\s*(\/\/|\/\*|\*|<!--)/;

test('内部リンクは resolve() を通っている（絶対パスの直書きが無い）', async () => {
	const root = new URL('../..', import.meta.url).pathname; // frontend/
	const found: string[] = [];

	for await (const rel of new Glob('src/**/*.{svelte,ts}').scan(root)) {
		if (rel === SELF) continue;
		const text = await Bun.file(root + rel).text();
		const lines = text.split('\n');
		for (const { why, re } of OFFENDERS) {
			for (const [i, line] of lines.entries()) {
				if (COMMENT.test(line)) continue;
				re.lastIndex = 0;
				if (re.test(line)) found.push(`${rel}:${i + 1} ${why} … ${line.trim()}`);
			}
		}
	}

	expect(
		found,
		'lite はサブパス配信なので、内部リンクは $app/paths の resolve() を通すこと' +
			'（例: href={resolve("/admin")}、href={resolve("/admin/[child]", { child: encodeURIComponent(name) })}）。\n' +
			found.join('\n')
	).toEqual([]);
});

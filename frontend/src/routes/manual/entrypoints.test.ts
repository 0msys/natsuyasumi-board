// マニュアルへの入口が、4つのヘッダーすべてに残っていることを見る。
//
// links.test.ts と同じで、描かずにソースを読む静的な番人。入口が1枚でも落ちると
// 「マニュアルはあるのに、そこへ行く手段が画面から消えている」という壊れ方をするが、
// これは誰も例外を出さないので気づけない。とくに /admin/new は定義がゼロの初回に
// 直行する画面で、ここを落とすと はじめて触る親が最初に着く画面から入口が消える。
//
// DOM で見ないのは、admin 配下の3枚がセッションやウィザードのフィクスチャを要求する
// ためで、入口1本のためにそれを組むのは割に合わない。アイコンだけの子どもページは
// アクセシブル名の抜けを静的には拾えないので、そこだけ routes/page.test.ts で描いて見る。
import { expect, test } from 'bun:test';

const ROOT = new URL('../../..', import.meta.url).pathname; // frontend/

/** newTab: 未保存の入力を抱える画面かどうか（下のテストの理由を参照）. */
const ENTRY_POINTS: { rel: string; newTab: boolean }[] = [
	{ rel: 'src/routes/+page.svelte', newTab: false },
	{ rel: 'src/routes/admin/+page.svelte', newTab: false },
	{ rel: 'src/routes/admin/new/+page.svelte', newTab: true },
	{ rel: 'src/routes/admin/[child]/+page.svelte', newTab: true }
];

const read = (rel: string) => Bun.file(ROOT + rel).text();

/** その入口の <a> だけを切り出す（同じヘッダーに戻るリンクも居るので混ぜない）. */
function manualAnchor(text: string): string | null {
	const at = text.indexOf("resolve('/manual')");
	if (at < 0) return null;
	const open = text.lastIndexOf('<a', at);
	const close = text.indexOf('>', at);
	return text.slice(open, close + 1);
}

test('マニュアルへの入口が4つのヘッダーに残っている', async () => {
	const missing: string[] = [];

	for (const { rel } of ENTRY_POINTS) {
		if (!(await read(rel)).includes("resolve('/manual')")) missing.push(rel);
	}

	expect(
		missing,
		'ヘッダーに <a href={resolve("/manual")}> が要る（lite はサブパス配信なので resolve() を通すこと）。\n' +
			missing.join('\n')
	).toEqual([]);
});

// 未保存の入力を抱える画面（ウィザードとセクションエディタ）からは、別タブで開く。
//
// ウィザードの入力は $state に持つだけで離脱ガードが無い。同じタブでマニュアルへ出ると、
// そこまで打った名前・学年・日づけが消えてステップ1へ戻る。しかも手が止まって
// マニュアルを開く親ほど、消える入力を持っている。
// エディタは離脱ガードがあるので消えはしないが、同じタブだと「離れると変更は失われます」の
// 確認が出て、読むか直すかの二択になる。どちらも target を外すと壊れるので、ここで固定する。
test('入力を抱える画面からは別タブで開く', async () => {
	const wrong: string[] = [];

	for (const { rel, newTab } of ENTRY_POINTS) {
		const anchor = manualAnchor(await read(rel));
		if (anchor === null) continue; // 上のテストが報告する
		const opensNewTab = anchor.includes('target="_blank"');
		if (opensNewTab !== newTab) {
			wrong.push(`${rel}: target="_blank" が ${opensNewTab ? 'ある' : '無い'}（期待: ${newTab ? 'ある' : '無い'}）`);
		}
		if (opensNewTab && !anchor.includes('rel="noopener"')) {
			wrong.push(`${rel}: target="_blank" に rel="noopener" が付いていない`);
		}
	}

	expect(wrong, wrong.join('\n')).toEqual([]);
});

// 仕様書に書いた画面数も、この一覧から数える（人手で数え直すと必ずずれる）。
test('仕様書の画面数の表記が、入口の一覧と合っている', async () => {
	const spec = 'docs/spec/screens/manual.md';
	const md = await Bun.file(new URL('../../../..', import.meta.url).pathname + spec).text();
	const newTab = ENTRY_POINTS.filter((e) => e.newTab).length;

	expect(md, `${spec}: 入口のある画面数を ${ENTRY_POINTS.length} に直すこと`).toContain(
		`${ENTRY_POINTS.length}画面のヘッダーから開けます`
	);
	expect(md, `${spec}: 別タブで開く画面数を ${newTab} に直すこと`).toContain(
		`未保存の入力を抱える${newTab}画面`
	);
	expect(md, `${spec}: 同じタブで開く画面数を ${ENTRY_POINTS.length - newTab} に直すこと`).toContain(
		`入力を持たない${ENTRY_POINTS.length - newTab}画面`
	);
	expect(md, `${spec}: テスト観点の画面数を ${ENTRY_POINTS.length} に直すこと`).toContain(
		`${ENTRY_POINTS.length}画面すべてのヘッダーに入口が残っている`
	);
});

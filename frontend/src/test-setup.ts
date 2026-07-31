// bun test の下ごしらえ（bunfig.toml の [test].preload から読まれる）。
//
// 目的は「マウント境界の挙動」を実際に描画して検査すること。子どもを切り替えたときに
// {#key} がコンポーネントを作り直しているか（＝前の子の入力や計測が残らないか）は、
// 描いてみないと確かめられない種類のバグで、実際に何度も取りこぼしている。
//
// コンポーネントを描くのに要るものは3つで、置き場所がそれぞれ違う:
//   - happy-dom（このファイル）: bun test は DOM を持たないので登録する（マウント先）
//   - bun-plugin-svelte（このファイル）: .svelte のコンパイル方法を bun test に教える。
//     forceSide: 'client' が要る——既定はビルド target から側を推測するので、bun test では
//     'server' 扱いになり SSR 用コード（$$renderer.push）が出てクライアント実行時に壊れる。
//   - svelte 本体をブラウザ側へ解決させる指定（package.json の test スクリプト）:
//     export map がサーバ版を指したままだと mount() が「サーバでは使えない」と拒む。
//     これだけは bunfig.toml に書けない（bun 1.3 は --conditions を CLI でしか見ない）ので、
//     `bun run test` が --conditions browser を渡している。下の番人がそれを強制する。
//
// ロジックだけのテスト（docTypes・uiText 等）は、この下ごしらえがあっても素通りする。
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { plugin } from 'bun';
import { SveltePlugin } from 'bun-plugin-svelte';

// svelte がサーバ版に解決されていたら、ここで止めて直しかたを伝える（上の3つめの番人）。
// 素の `bun test` で走らせるとコンポーネントの検査が「lifecycle_function_unavailable」で
// 軒並み落ち、原因が読み取れない。1行で理由が分かるようにしておく。
if (Bun.resolveSync('svelte', import.meta.dir).includes('index-server')) {
	throw new Error(
		'コンポーネントテストには svelte のブラウザ解決が要ります。`bun run test` を使ってください' +
			'（素の `bun test` だと --conditions browser が渡らず、mount() が「サーバでは使えない」と拒みます）。'
	);
}

if (!globalThis.document) GlobalRegistrator.register();

// bun-plugin-svelte@0.0.6 は <style> を持つコンポーネントで落ちる: 仮想CSSを
// "bun-svelte:<名前>.css" というキーで登録するのに、読み出しは名前空間接頭辞が
// 外れた path で引くため必ず取り違える（Virtual CSS module not found）。
// テストに見た目は要らないので、先に空のモジュールを返して肩代わりする
// （bun test のランタイムプラグインは css ローダを受け付けないため js として返す＝
// コンポーネント側の import が無害な no-op になる）。
// プラグインの不具合が直ったら、この差し込みごと消してよい。
plugin({
	name: 'stub-svelte-virtual-css',
	setup(builder) {
		builder.onLoad({ filter: /\.css$/, namespace: 'bun-svelte' }, () => ({
			contents: '',
			loader: 'js'
		}));
	}
});
plugin(SveltePlugin({ forceSide: 'client', development: true }));

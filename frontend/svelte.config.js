import nodeAdapter from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';

// ビルドは2種類ある。切り替えるのは環境変数 NYB_TARGET だけ（設定ファイルは分けない
// ＝runes 強制などの共通部分を二重管理しないため）。
//
//   既定（NYB_TARGET 未設定）… docker 版。adapter-node で配信し、/api は
//                              src/hooks.server.ts が FastAPI へ中継する。
//   NYB_TARGET=lite        … lite 版。バックエンド無しの静的サイト（GitHub Pages）。
//                              保存はブラウザ（src/lib/store）で、api の実装ごと差し替える。
const LITE = process.env.NYB_TARGET === 'lite';

// GitHub Pages はリポジトリ名のサブパスで配信される（/natsuyasumi-board）。
// 独自ドメインなどで直下に置くときは空文字を渡す。
const BASE = process.env.NYB_BASE ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// プロジェクト全体で runes モードを強制（node_modules のライブラリは除く）
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-node: 本番は `node build` で配信する（Docker の frontend イメージが使う）。
		// /api の中継は src/hooks.server.ts の handle が行う（開発時は vite の proxy）。
		// adapter-static: 動的ルート /admin/[child] があるので prerender では出し切れない。
		// GitHub Pages は未知のパスに 404.html を返すので、それを SPA フォールバックに使う。
		//
		// 出力先を build-lite に分けているのは、既定の build を docker 版が使うため。
		// 同じ場所に書くと、lite をビルドした瞬間に起動中の `node build` が壊れる
		// （実際にそれで node 側が 500 を返した）。
		adapter: LITE
			? staticAdapter({ pages: 'build-lite', assets: 'build-lite', fallback: '404.html' })
			: nodeAdapter(),

		// relative: false が要（既定は true）。true だとアセット参照が ./_app/... の相対パスに
		// なり、/natsuyasumi-board/admin/はな のような深いパスへ 404.html を配信したとき
		// _app が別階層を指して全アセットが 404 になる。絶対パスに固定する。
		paths: LITE ? { base: BASE, relative: false } : {},

		// api の実装の差し替え口。$lib/api/index.ts だけがここを指す。
		// ビルド時 alias にしているので、使われないほうは import グラフに現れない
		// （バンドルに残らないことが tree-shaking 頼みでなく構造で決まる）。
		alias: {
			$apiImpl: LITE ? 'src/lib/api/local/index.ts' : 'src/lib/api/client.ts'
		},

		// Service Worker は lite だけ。docker 版は LAN 内で毎回取りに行けばよく、
		// 逆にキャッシュが残ると「直したのに古い画面が出る」の原因になる。
		serviceWorker: { register: LITE }
	}
};

export default config;

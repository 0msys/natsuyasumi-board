import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// プロジェクト全体で runes モードを強制（node_modules のライブラリは除く）
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// adapter-node: 本番は `node build` で配信する（Docker の frontend イメージが使う）。
		// /api の中継は src/hooks.server.ts の handle が行う（開発時は vite の proxy）。
		adapter: adapter()
	}
};

export default config;

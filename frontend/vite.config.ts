import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// lite ビルドかどうかを、コードから見えるようにする（svelte.config.js の NYB_TARGET と同じ旗）。
	// 用途は2つ: +layout.ts の prerender の出し分けと、マニュアルの既定タブ（src/lib/manual/edition.ts）。
	//
	// これは define であってグローバル変数ではないので、bun test には存在しない。裸で参照すると
	// ReferenceError でテストが落ちるため、読む側は typeof でくるむこと（vite 側では識別子が
	// 字句置換されて `typeof true` になり、そのまま畳まれる）。
	define: {
		__NYB_LITE__: JSON.stringify(process.env.NYB_TARGET === 'lite')
	},
	// /api の中継は hooks.server.ts に一本化する（vite の proxy は置かない）。
	// vite の proxy は SvelteKit の handle より先に横取りするため、置くと dev だけ
	// hooks を通らず、プロキシが付ける x-real-client も落ちる。その結果 backend からは
	// 全員が同じ送信元に見え、管理PINのスロットルが1つに潰れて管理者を締め出せてしまう。
	server: {
		host: '0.0.0.0',
		// Docker で公開するポート（docker-compose.yml の frontend.ports）とそろえる。
		// 8080 は家庭内サーバで取り合いになりやすいので避けている。
		port: 8082,
		strictPort: true
	}
});

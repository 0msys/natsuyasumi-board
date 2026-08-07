/// <reference lib="webworker" />
// lite（静的サイト）だけで動く Service Worker。docker 版では登録しない
// （svelte.config.js の serviceWorker.register）。
//
// ねらいは2つ:
//   - ホーム画面に追加したあと、電波が悪くても開けること
//   - 毎回ネットから取り直さないこと（古いタブレットで効く）
//
// skipWaiting() / clients.claim() は使わない。管理画面には未保存のドラフトを守る
// 離脱ガードがあるので、編集中に新しい版へ強制的に切り替わるのがいちばん困る。
// 既定どおり「次に全部のタブを閉じて開き直したとき」に入れ替わればよい。
import { base, build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// 版ごとに別のキャッシュを持ち、有効化のときに古いものを消す。
// 接頭辞を付けているのは、GitHub Pages が他のプロジェクトと同じオリジンなので、
// よそのキャッシュを巻き添えで消さないため。
const CACHE = `nyb-v${version}`;

// 動的ルート（/admin/はな）に配られる入れ物。GitHub Pages は未知のパスにこれを返す。
// 静的サイトの出力なので build にも files にも入らない＝名指しで控える必要がある。
const FALLBACK = `${base}/404.html`;

// prerendered を入れ忘れると、控えてあるのは JS と CSS だけになり、
// 圏外で開いたときに肝心の HTML が無くて何も出せない。
const ASSETS = [...build, ...files, ...prerendered, FALLBACK];

sw.addEventListener('install', (event) => {
	// 1つずつ控える。cache.addAll() は1本でも取れないと全部を巻き戻すので、
	// そのとき install ごと失敗して Service Worker が登録されないまま消える
	// （＝「ホーム画面に追加すれば圏外でも開ける」が黙って成り立たなくなる）。
	// 取れなかったものは、そのとき取りにいけばよい。
	event.waitUntil(
		caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key.startsWith('nyb-v') && key !== CACHE) await caches.delete(key);
			}
		})
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// ビルド成果物は内容ごとに名前が変わるので、あれば無条件に使ってよい
			if (ASSETS.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}
			try {
				const response = await fetch(request);
				// 成功したものだけ控えておく（エラー応答を焼き付けない）
				if (response.status === 200) cache.put(request, response.clone());
				return response;
			} catch {
				// 圏外。まったく同じ URL の控えがあればそれを出す。
				const hit = await cache.match(request);
				if (hit) return hit;
				// ページを開こうとしているなら、入れ物さえ返せば中身は画面側が組み立てる。
				// /admin/はな のような動的なパスは、そもそも同じ URL の控えを持てない
				// （子どもの名前は列挙できない）ので、ここに来るのが普通の経路になる。
				if (request.mode === 'navigate') {
					const shell = (await cache.match(FALLBACK)) ?? (await cache.match(`${base}/`));
					if (shell) return shell;
				}
				throw new Error('オフラインで、控えもありません');
			}
		})()
	);
});

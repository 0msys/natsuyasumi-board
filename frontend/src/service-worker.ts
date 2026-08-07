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

// 圏外で1ページでも開くのに、どうしても要るもの。
//   build       … その版の JS と CSS（欠けると画面が組み立たない）
//   入れ物 1枚  … prerendered の先頭（サブパス直下＝ / のページ）
// prerendered を入れ忘れると、控えてあるのは JS と CSS だけになり、
// 圏外で開いたときに肝心の HTML が無くて何も出せない。
const SHELL = prerendered[0];
const ESSENTIAL = SHELL ? [...build, SHELL] : [...build];

// 無くても「開けなくなる」ことはないもの。アイコン・manifest・ほかのページ、
// それに 404.html（動的ルートの入れ物。GitHub Pages には在るが、ローカルの
// preview では配られない＝ここで必須にすると開発中だけ Service Worker が入らない）。
const OPTIONAL = [...files, ...prerendered.slice(1), FALLBACK].filter((url) => url !== SHELL);

/** 控える対象ぜんぶ（fetch 側が「内容ごとに名前が変わるもの」を見分けるのに使う）。 */
const ASSETS = [...ESSENTIAL, ...OPTIONAL];

sw.addEventListener('install', (event) => {
	// 要るものは addAll で「ぜんぶ揃ったときだけ」入れる。
	//
	// ここを allSettled にすると、電波の悪いところで更新したときに、中途半端に控えた
	// まま install が成功してしまう。そのあと activate が**完全だった古いキャッシュを
	// 消す**ので、次に圏外で開いたときに入れ物だけ返って中身が読めない、という
	// 前より悪い状態になる。揃わなければ install ごと失敗させれば、古い版がそのまま
	// 残って動き続ける。
	//
	// 逆に、無くても開ける類まで addAll に混ぜてはいけない。1本でも取れないと
	// 全部が巻き戻り、Service Worker が登録されないまま消える（それで実際に
	// 「ホーム画面に追加すれば圏外でも開ける」が黙って成り立たなくなっていた）。
	event.waitUntil(
		caches.open(CACHE).then(async (cache) => {
			await cache.addAll(ESSENTIAL);
			await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
		})
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

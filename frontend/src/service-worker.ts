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
import { splitCacheTargets } from '$lib/sw/assets';

const sw = self as unknown as ServiceWorkerGlobalScope;

// 版ごとに別のキャッシュを持ち、有効化のときに古いものを消す。
// 接頭辞を付けているのは、GitHub Pages が他のプロジェクトと同じオリジンなので、
// よそのキャッシュを巻き添えで消さないため。
const CACHE = `nyb-v${version}`;

// 動的ルート（/admin/はな）に配られる入れ物。GitHub Pages は未知のパスにこれを返す。
// 静的サイトの出力なので build にも files にも入らない＝名指しで控える必要がある。
const FALLBACK = `${base}/404.html`;

// 控える先を2つに分ける（分けかたと理由は $lib/sw/assets）。
//
//   ESSENTIAL … 圏外で1ページでも開くのにどうしても要るもの。その版の JS と CSS に、
//               サブパス直下（/）のページの HTML を1枚。入れ物を控え忘れると、
//               あるのは JS と CSS だけになり、圏外では何も出せない。
//               どれがその1枚かは prerendered の並び順ではなく名指しで決める。
//   OPTIONAL  … 無くても「開けなくなる」ことはないもの。アイコン・manifest・ほかのページ、
//               それに 404.html（動的ルートの入れ物。GitHub Pages には在るが、ローカルの
//               preview では配られない＝必須にすると開発中だけ Service Worker が入らない）。
//   FAIL_CLOSED … その入れ物が名指しで見つからなかった（＝控えても圏外では何も出せない）。
const {
	shell: SHELL,
	essential: ESSENTIAL,
	optional: OPTIONAL,
	failClosed: FAIL_CLOSED
} = splitCacheTargets({
	build,
	files,
	prerendered,
	base,
	fallback: FALLBACK
});

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
		(async () => {
			// 圏外に出す入れ物がそもそも決まらないときは、控える前にここで失敗させる。
			// JS と CSS だけ揃えても圏外では何も出せないのに、addAll は成功してしまい、
			// activate が完全だった前の版のキャッシュを消す（＝更新前より悪くなる）。
			// いまのビルドはルートを prerender するのでここには来ない。来るとしたら、
			// ルートの prerender を外したときや動的ルートへ寄せたとき——ビルドも CI も
			// 通ってしまう変更なので、気づける場所をここに置いておく。
			if (FAIL_CLOSED) {
				throw new Error(`圏外用の入れ物（${base}/）が prerender されていません`);
			}
			const cache = await caches.open(CACHE);
			await cache.addAll(ESSENTIAL);
			await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
		})()
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
				// 成功したものだけ控えておく（エラー応答を焼き付けない）。
				//
				// 投げっぱなしにせず waitUntil に預ける。ブラウザは答えを返した Service Worker を
				// すぐ止めてよいことになっていて（古いタブレットほど早く止まる）、預けていない
				// 書き込みはそこで打ち切られる＝画面には出たのに控えは残らない、が起きる。
				// 置き場がいっぱいで書けなかったときも、預けてあれば誰も拾わない失敗にならない。
				if (response.status === 200) event.waitUntil(cache.put(request, response.clone()));
				return response;
			} catch {
				// 圏外。まったく同じ URL の控えがあればそれを出す。
				const hit = await cache.match(request);
				if (hit) return hit;
				// ページを開こうとしているなら、入れ物さえ返せば中身は画面側が組み立てる。
				// /admin/はな のような動的なパスは、そもそも同じ URL の控えを持てない
				// （子どもの名前は列挙できない）ので、ここに来るのが普通の経路になる。
				if (request.mode === 'navigate') {
					// 控えたのと同じ入れ物を出す。ここに `${base}/` を書き写すと、
					// 控える側の判断が変わったときに片方だけずれて、圏外で空振りする。
					const shell =
						(await cache.match(FALLBACK)) ?? (SHELL ? await cache.match(SHELL) : undefined);
					if (shell) return shell;
				}
				throw new Error('オフラインで、控えもありません');
			}
		})()
	);
});

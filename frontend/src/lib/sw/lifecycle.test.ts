// Service Worker 本体（src/service-worker.ts）を実際に動かして、更新のときの振る舞いを固定する。
//
// 隣の assets.test.ts が見ているのは「控える先の分けかた」という判断だけで、**本体が
// その判断を使っているか**は見ていない。本体が `${base}/` を直書きに戻しても、install の
// addAll と allSettled を1本にまとめても、あちらは緑のままになる。ここでいちばん壊れると
// 痛いのは判断そのものではなく、「揃わなかったときに前の版を残す」という更新の手順なので、
// 本体をそのまま読み込んで install・activate・fetch を直接叩く。
//
// 読み込み方: 本体は `$service-worker` を import していて、これは Service Worker の
// ビルドの中でしか解決できない。そこで束ねるときだけ「評価のときに渡された値を返すだけ」の
// 偽物へ差し替える。束ねるのは1回きりで、版ごとの違い（version・prerender の並び）は
// **評価のときに渡す値**で作る＝中身は毎回ほんものの service-worker.ts が動く。
//
// caches / self / fetch / location は、束ねたコードを関数の引数として受け取らせて差し替える
// （引数がグローバルを隠す）。globalThis を書き換えないので、テストどうしが干渉しない。
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

const SRC = resolve(import.meta.dir, '../..');

const ORIGIN = 'https://0msys.github.io';
const BASE = '/natsuyasumi-board';
const SHELL = `${BASE}/`;
const FALLBACK = `${BASE}/404.html`;
const APP_JS = `${BASE}/_app/immutable/entry/app.js`;
const APP_CSS = `${BASE}/_app/immutable/assets/0.css`;
const ICON = `${BASE}/icons/icon-192.png`;

/** いまの lite ビルドが $service-worker から渡してくるものと同じ形。 */
const MANIFEST: Manifest = {
	base: BASE,
	build: [APP_JS, APP_CSS],
	files: [`${BASE}/manifest.webmanifest`, ICON],
	prerendered: [SHELL, `${BASE}/admin`, `${BASE}/admin/new`],
	version: '2'
};

type Manifest = {
	base: string;
	build: string[];
	files: string[];
	prerendered: string[];
	version: string;
};

type FakeResponse = { status: number; body: string; clone(): FakeResponse };
type FakeRequest = { url: string; method: string; mode: string };
type Fetchable = string | FakeRequest;
type Fetcher = (target: Fetchable) => Promise<FakeResponse>;

/** Cache API のうち、本体が使うところだけ。 */
type CacheApi = {
	addAll(urls: string[]): Promise<void>;
	add(url: string): Promise<void>;
	put(request: Fetchable, response: FakeResponse): Promise<void>;
	match(target: Fetchable): Promise<FakeResponse | undefined>;
};
type CachesApi = {
	open(name: string): Promise<CacheApi>;
	keys(): Promise<string[]>;
	delete(name: string): Promise<boolean>;
};

type SwGlobal = { addEventListener(type: string, listener: unknown): void };
type LifecycleEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = LifecycleEvent & {
	request: FakeRequest;
	respondWith(response: Promise<FakeResponse>): void;
};
type Evaluate = (
	self: SwGlobal,
	caches: CachesApi,
	location: { origin: string },
	fetch: Fetcher,
	manifest: Manifest
) => void;

/**
 * 控えの鍵。本体は cache.match に「文字列のパス」と「要求そのもの」の両方を渡すので、
 * どちらもパスに揃える（実物の Cache は URL 全体で引くが、ここで見たい話に query は出てこない）。
 */
const keyOf = (target: Fetchable): string =>
	typeof target === 'string' ? target : new URL(target.url).pathname;

const makeResponse = (status: number, body: string): FakeResponse => {
	const response: FakeResponse = { status, body, clone: () => ({ ...response }) };
	return response;
};

/** 束ねた本体（テストのあいだ1回だけ作る）。 */
let bundled: Promise<string> | undefined;

function swBundle(): Promise<string> {
	bundled ??= (async () => {
		const built = await Bun.build({
			entrypoints: [resolve(SRC, 'service-worker.ts')],
			target: 'browser',
			// iife にするのは、束ねたものを new Function の中身としてそのまま評価するため
			// （import/export が残ると評価できない）。
			format: 'iife',
			plugins: [
				{
					name: 'nyb-sw-test-env',
					setup(builder) {
						// $service-worker はビルドの中でしか解決できない。評価のときに渡す
						// __swManifest を読むだけの偽物に差し替える（＝束ねるのは1回で済む）。
						builder.onResolve({ filter: /^\$service-worker$/ }, () => ({
							path: 'manifest',
							namespace: 'nyb-sw'
						}));
						builder.onLoad({ filter: /.*/, namespace: 'nyb-sw' }, () => ({
							contents: [
								'export const base = __swManifest.base;',
								'export const build = __swManifest.build;',
								'export const files = __swManifest.files;',
								'export const prerendered = __swManifest.prerendered;',
								'export const version = __swManifest.version;'
							].join('\n'),
							loader: 'js'
						}));
						// $lib は svelte-kit が付ける別名なので、束ねるときは自分で解決する。
						builder.onResolve({ filter: /^\$lib\// }, (args) => ({
							path: Bun.resolveSync(`./${args.path.slice('$lib/'.length)}`, resolve(SRC, 'lib'))
						}));
					}
				}
			]
		});
		if (!built.success) throw new AggregateError(built.logs, 'service-worker.ts を束ねられません');
		return await built.outputs[0].text();
	})();
	return bundled;
}

/** テスト用の網。どこが落ちているかを都度切り替える。 */
function createNet() {
	const net = {
		/** 圏外（全部落ちる） */
		offline: false,
		/** この道だけ落ちる（更新のときに1本だけ取れない、を作る） */
		broken: new Set<string>(),
		/** 200 以外を返させる */
		status: new Map<string, number>(),
		/** 取りに行った順（控えで済ませたかを見る） */
		log: [] as string[],
		fetch: (async (target: Fetchable) => {
			const path = keyOf(target);
			net.log.push(path);
			if (net.offline || net.broken.has(path)) throw new TypeError(`取りに行けません: ${path}`);
			return makeResponse(net.status.get(path) ?? 200, `body:${path}`);
		}) as Fetcher
	};
	return net;
}

/**
 * テスト用の CacheStorage。実物に合わせるのは2つ:
 *   - addAll は「ぜんぶ揃ったときだけ入る」
 *   - put は書き終わるまでに間がある（同期では書けない）
 * とくに後者を同期にすると、本体が書き込みを waitUntil に預け忘れていても気づけない。
 * 実物は答えを返したあとに Service Worker を止められるので、預け忘れは「画面には出たのに
 * 控えは残らない」になる——テストの偽物が本体より親切だと、そこが緑のまま通る。
 */
function createCaches(net: ReturnType<typeof createNet>) {
	const store = new Map<string, Map<string, FakeResponse>>();
	/** 書き込みを止めておく関門（止めているあいだ put は終わらない）。 */
	let gate: Promise<void> | undefined;
	let openGate: (() => void) | undefined;
	let writesFail = false;

	const fetchOk = async (url: string) => {
		const response = await net.fetch(url);
		// 実物の add/addAll は 2xx 以外を拒む。
		if (response.status < 200 || response.status > 299) {
			throw new TypeError(`${response.status} が返りました: ${url}`);
		}
		return response;
	};

	const entriesOfName = (name: string) => {
		const found = store.get(name);
		if (found) return found;
		const created = new Map<string, FakeResponse>();
		store.set(name, created);
		return created;
	};

	const api: CachesApi = {
		open: async (name) => {
			const entries = entriesOfName(name);
			return {
				addAll: async (urls) => {
					// 1本でも取れなければ、何も入れずに失敗する（実物と同じ）。
					// ここが「取れたぶんだけ入れる」に変わると、中途半端な控えのまま
					// install が成功し、activate が完全だった前の版を消す。
					const responses = await Promise.all(urls.map(fetchOk));
					urls.forEach((url, i) => entries.set(keyOf(url), responses[i]));
				},
				add: async (url) => {
					entries.set(keyOf(url), await fetchOk(url));
				},
				put: async (request, response) => {
					await (gate ?? Promise.resolve());
					if (writesFail) throw new Error('控えの置き場がいっぱいです');
					entries.set(keyOf(request), response);
				},
				match: async (target) => entries.get(keyOf(target))
			};
		},
		keys: async () => [...store.keys()],
		delete: async (name) => store.delete(name)
	};

	return {
		api,
		/** いま在るキャッシュの名前（作られた順）。 */
		names: () => [...store.keys()],
		/** その名前のキャッシュに控えてあるパス。 */
		pathsIn: (name: string) => [...(store.get(name)?.keys() ?? [])],
		bodyIn: (name: string, path: string) => store.get(name)?.get(path)?.body,
		/** 控えの書き込みを止めておく（＝答えを返したあとも、まだ書き終わっていない状態）。 */
		holdWrites: () => {
			gate = new Promise<void>((resolve) => (openGate = resolve));
		},
		releaseWrites: () => {
			openGate?.();
			gate = undefined;
		},
		/** 置き場がいっぱいで書けない端末にする。 */
		failWrites: () => {
			writesFail = true;
		},
		/** 前の版が控えていたことにする。 */
		seed: (name: string, paths: string[]) => {
			const entries = entriesOfName(name);
			for (const path of paths) entries.set(path, makeResponse(200, `old:${path}`));
		}
	};
}

/**
 * 網とキャッシュを共有する世界を1つ作る。boot() を2回呼べば「前の版と新しい版」を
 * 同じキャッシュの上に並べられる（更新の失敗を見るのにこれが要る）。
 */
async function createWorld() {
	const code = await swBundle();
	const evaluate = new Function(
		'self',
		'caches',
		'location',
		'fetch',
		'__swManifest',
		code
	) as unknown as Evaluate;

	const net = createNet();
	const caches = createCaches(net);

	const boot = (manifest: Manifest) => {
		const lifecycle = new Map<string, (event: LifecycleEvent) => void>();
		let onFetch: ((event: FetchEvent) => void) | undefined;
		/** 直前の fetch で waitUntil に預けられた処理（＝Service Worker を止めてはいけない間の仕事）。 */
		let kept: Promise<unknown>[] = [];

		const self: SwGlobal = {
			addEventListener(type, listener) {
				if (type === 'fetch') onFetch = listener as (event: FetchEvent) => void;
				else lifecycle.set(type, listener as (event: LifecycleEvent) => void);
			}
		};
		evaluate(self, caches.api, { origin: ORIGIN }, net.fetch, manifest);

		/** install / activate を叩き、waitUntil に渡された処理の終わりまで待つ。 */
		const dispatch = async (type: 'install' | 'activate') => {
			const listener = lifecycle.get(type);
			if (!listener) throw new Error(`${type} を受け取る listener がいません`);
			const waits: Promise<unknown>[] = [];
			listener({ waitUntil: (promise) => void waits.push(promise) });
			await Promise.all(waits);
		};

		return {
			install: () => dispatch('install'),
			activate: () => dispatch('activate'),
			/**
			 * fetch を叩く。respondWith が呼ばれなければ undefined＝
			 * 「Service Worker は手を出さず、ブラウザがそのまま取りに行く」。
			 */
			fetch: (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => {
				if (!onFetch) throw new Error('fetch を受け取る listener がいません');
				const request: FakeRequest = {
					url: `${init.origin ?? ORIGIN}${path}`,
					method: init.method ?? 'GET',
					mode: init.mode ?? 'no-cors'
				};
				let answered: Promise<FakeResponse> | undefined;
				kept = [];
				onFetch({
					request,
					respondWith: (response) => void (answered = response),
					waitUntil: (promise) => void kept.push(promise)
				});
				return answered;
			},
			/** 直前の fetch が waitUntil に預けた処理。空なら、ブラウザはもう止めてよい。 */
			keptAlive: () => kept
		};
	};

	return { net, caches, boot };
}

/** install も activate も済んだ、ふつうに使える状態を作る。 */
async function serving(manifest: Manifest = MANIFEST) {
	const world = await createWorld();
	const sw = world.boot(manifest);
	await sw.install();
	await sw.activate();
	world.net.log.length = 0;
	return { ...world, sw };
}

describe('install（要るものが揃ったときだけ控える）', () => {
	it('ぜんぶ取れれば、その版の JS/CSS と入れ物、それに任意のものも入る', async () => {
		const world = await createWorld();
		const sw = world.boot(MANIFEST);

		await sw.install();

		const cached = world.caches.pathsIn('nyb-v2');
		expect(cached).toContain(APP_JS);
		expect(cached).toContain(APP_CSS);
		expect(cached).toContain(SHELL);
		expect(cached).toContain(FALLBACK);
		expect(cached).toContain(ICON);
	});

	it('任意のものが取れなくても install は通る（404.html が配られない preview）', async () => {
		const world = await createWorld();
		const sw = world.boot(MANIFEST);
		// 404.html は GitHub Pages には在るがローカルの preview では配られない。
		// ここで install ごと失敗させると、開発中だけ Service Worker が入らなくなる。
		world.net.broken.add(FALLBACK);
		world.net.broken.add(`${BASE}/admin/new`);

		await sw.install();
		await sw.activate();

		const cached = world.caches.pathsIn('nyb-v2');
		expect(cached).toContain(APP_JS);
		expect(cached).toContain(SHELL);
		expect(cached).not.toContain(FALLBACK);
		expect(cached).toContain(ICON);
	});

	it('要るものが1本でも欠けたら install ごと失敗し、控えは1つも残らない', async () => {
		const world = await createWorld();
		world.caches.seed('nyb-v1', [SHELL, APP_JS]);
		const sw = world.boot(MANIFEST);
		world.net.broken.add(APP_CSS);

		await expect(sw.install()).rejects.toThrow();

		// 中途半端に控えて install が成功すると、activate が完全だった前の版を消す。
		expect(world.caches.pathsIn('nyb-v2')).toEqual([]);
		// 前の版はそのまま。activate は走らないので消されない。
		expect(world.caches.pathsIn('nyb-v1')).toContain(SHELL);
	});

	it('圏外用の入れ物が prerender されていない版では、取りに行く前に失敗する', async () => {
		const world = await createWorld();
		world.caches.seed('nyb-v1', [SHELL]);
		// ルートを動的ルートへ寄せると、ビルドも CI も通ったままこの形になる。
		const sw = world.boot({ ...MANIFEST, prerendered: [`${BASE}/admin`, `${BASE}/admin/new`] });

		await expect(sw.install()).rejects.toThrow('prerender');

		// JS/CSS だけ控えても圏外では何も出せない。1本も取りに行かず、
		// 新しいキャッシュを作りもしないこと（作れば activate 後にゴミが残る）。
		expect(world.net.log).toEqual([]);
		expect(world.caches.names()).toEqual(['nyb-v1']);
	});

	it('vite dev のように中身が空の版では、何も控えずに install だけ通す', async () => {
		const world = await createWorld();
		const sw = world.boot({ ...MANIFEST, build: [], files: [], prerendered: [] });

		await sw.install();

		// 圏外で出す中身がそもそも無く、守るべき前の版も無い（ここで落とすと開発中ずっと赤い）。
		expect(world.caches.pathsIn('nyb-v2')).toEqual([FALLBACK]);
	});
});

describe('activate（古いキャッシュを消すのは activate のあと）', () => {
	it('install が済んだだけでは、前の版のキャッシュはまだ消えない', async () => {
		const world = await createWorld();
		world.caches.seed('nyb-v1', [SHELL, APP_JS]);
		const sw = world.boot(MANIFEST);

		await sw.install();

		// 新しい版が使えるようになるまで、前の版を消してはいけない
		// （install の途中で電池が切れても、前の版で開ける）。
		expect(world.caches.names()).toContain('nyb-v1');
		expect(world.caches.pathsIn('nyb-v1')).toContain(SHELL);
	});

	it('activate すると、この版以外の nyb-v* だけ消える', async () => {
		const world = await createWorld();
		world.caches.seed('nyb-v1', [SHELL]);
		world.caches.seed('nyb-v0', [SHELL]);
		// GitHub Pages は他のプロジェクトと同じオリジン。よそのキャッシュを巻き添えにしない。
		world.caches.seed('other-app-v1', ['/よそ/index.html']);
		const sw = world.boot(MANIFEST);

		await sw.install();
		await sw.activate();

		expect(world.caches.names()).not.toContain('nyb-v1');
		expect(world.caches.names()).not.toContain('nyb-v0');
		expect(world.caches.names()).toContain('other-app-v1');
		expect(world.caches.names()).toContain('nyb-v2');
	});
});

describe('fetch（圏外で何を返すか）', () => {
	it('版ごとに名前が変わるものは、控えがあれば取りに行かない', async () => {
		const { sw, net } = await serving();

		const response = await sw.fetch(APP_JS);

		expect(response?.body).toBe(`body:${APP_JS}`);
		expect(net.log).toEqual([]);
	});

	it('取れた 200 は控えるが、エラー応答は焼き付けない', async () => {
		const { sw, net } = await serving();
		net.status.set(`${BASE}/missing.json`, 404);

		expect((await sw.fetch(`${BASE}/hello.json`))?.status).toBe(200);
		expect((await sw.fetch(`${BASE}/missing.json`))?.status).toBe(404);

		net.offline = true;
		expect((await sw.fetch(`${BASE}/hello.json`))?.body).toBe(`body:${BASE}/hello.json`);
		// 404 を控えていたら、圏外でこれが返ってしまう。
		await expect(sw.fetch(`${BASE}/missing.json`)).rejects.toThrow();
	});

	it('控えを書き終えるまで、fetch のイベントを閉じない', async () => {
		const { sw, caches } = await serving();
		// 実物の put は答えを返したあとに終わる。ブラウザはそこで Service Worker を
		// 止めてよく（古いタブレットほど早く止まる）、預けていない書き込みは打ち切られる。
		caches.holdWrites();

		const response = await sw.fetch(`${BASE}/hello.json`);

		expect(response?.status).toBe(200);
		expect(caches.pathsIn('nyb-v2')).not.toContain(`${BASE}/hello.json`);
		// waitUntil に預けてあれば、ブラウザはここで止めない＝控えが残る。
		expect(sw.keptAlive()).toHaveLength(1);
		caches.releaseWrites();
		await Promise.all(sw.keptAlive());
		expect(caches.pathsIn('nyb-v2')).toContain(`${BASE}/hello.json`);
	});

	it('控えを書けない端末でも、画面には応答が返る', async () => {
		const { sw, caches } = await serving();
		// 置き場がいっぱいの端末。書けないこと自体は仕方がないが、
		// 投げっぱなしだと誰も拾わない失敗になる（イベントに預けてあれば残る）。
		caches.failWrites();

		const response = await sw.fetch(`${BASE}/hello.json`);

		expect(response?.status).toBe(200);
		await expect(Promise.all(sw.keptAlive())).rejects.toThrow('いっぱい');
	});

	it('圏外では、控えた 404.html でどの子どものページも開ける', async () => {
		const { sw, net } = await serving();
		net.offline = true;

		// /admin/はな のような動的なパスは、名前を列挙できないので控えを持てない。
		const response = await sw.fetch(`${BASE}/admin/はな`, { mode: 'navigate' });

		expect(response?.body).toBe(`body:${FALLBACK}`);
	});

	it('404.html を控えられなかった版では、直下のページの控えで開ける', async () => {
		const world = await createWorld();
		const sw = world.boot(MANIFEST);
		world.net.broken.add(FALLBACK);
		await sw.install();
		await sw.activate();
		world.net.offline = true;

		const response = await sw.fetch(`${BASE}/admin/はな`, { mode: 'navigate' });

		expect(response?.body).toBe(`body:${SHELL}`);
	});

	it('入れ物が末尾の / 無しで出ている版でも、深いパスを開ける', async () => {
		// SvelteKit がルートに付ける名前が `${base}` に変わっても圏外で開けること
		// （控える側は両方見ている。本体がその答えを使っているかをここで見る）。
		const world = await createWorld();
		const sw = world.boot({ ...MANIFEST, prerendered: [BASE, `${BASE}/admin`] });
		world.net.broken.add(FALLBACK);
		await sw.install();
		await sw.activate();
		world.net.offline = true;

		const response = await sw.fetch(`${BASE}/admin/はな`, { mode: 'navigate' });

		expect(response?.body).toBe(`body:${BASE}`);
	});

	it('圏外で、控えも入れ物も使えない要求は諦める', async () => {
		const { sw, net } = await serving();
		net.offline = true;

		// ページを開こうとしているわけではないので、入れ物を返しても意味がない。
		await expect(sw.fetch(`${BASE}/あとから.json`)).rejects.toThrow();
	});

	it('GET 以外とよそのオリジンには手を出さない', async () => {
		const { sw } = await serving();

		expect(sw.fetch(`${BASE}/admin`, { method: 'POST' })).toBeUndefined();
		expect(sw.fetch('/fonts/x.woff2', { origin: 'https://example.com' })).toBeUndefined();
	});
});

// この機能でいちばん痛い壊れかたは「更新に失敗して、前の版まで道連れになる」こと。
// 前の版と新しい版を同じキャッシュの上に並べて、そこを通しで見る。
describe('更新に失敗しても、前の版のまま圏外で開ける', () => {
	it('新しい版の JS が取れないとき、古い版の控えは消えない', async () => {
		const world = await createWorld();

		// 前の版はちゃんと入って動いている
		const before = world.boot({ ...MANIFEST, version: '1' });
		await before.install();
		await before.activate();

		// 電波の悪いところで新しい版に出会い、要るものが1本取れない
		const NEXT_JS = `${BASE}/_app/immutable/entry/app.next.js`;
		const after = world.boot({ ...MANIFEST, version: '2', build: [NEXT_JS, APP_CSS] });
		world.net.broken.add(NEXT_JS);
		await expect(after.install()).rejects.toThrow();

		// 新しい版は activate まで進まない＝古いキャッシュを消す者がいない
		expect(world.caches.names()).toContain('nyb-v1');
		expect(world.caches.pathsIn('nyb-v1')).toContain(SHELL);

		// そのまま圏外へ。前の版が、控えたとおりに出せること。
		world.net.offline = true;
		expect((await before.fetch(`${BASE}/admin/はな`, { mode: 'navigate' }))?.body).toBe(
			`body:${FALLBACK}`
		);
		expect((await before.fetch(APP_JS))?.body).toBe(`body:${APP_JS}`);
	});
});

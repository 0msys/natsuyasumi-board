// 保存の入口。読みはメモリ上の1本のドキュメント、書きは直列化して保存へ流す。
import { emptyDb, normalizeDb, type Db } from './model';
import { idbAvailable, idbPersistence } from './idb';
import { memoryPersistence, type Persistence } from './persist';

/** 多タブへ「書いたよ」を知らせる通路。 */
const CHANNEL = 'nyb';

let persistence: Persistence | null = null;
let loaded: Db | null = null;
let loading: Promise<Db> | null = null;
// 書き込みを直列につなぐ鎖。並行して await すると、両方が同じ内容を読んでから
// 書き戻して片方の変更が消える（ロストアップデート）。
let chain: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
const watchers = new Set<(db: Db) => void>();
/** この端末で IndexedDB が使えないと分かったか（プライベートブラウズなど）。 */
let storageUnavailable = false;

function pickPersistence(): Persistence {
	if (persistence) return persistence;
	persistence = idbAvailable() ? idbPersistence() : fallbackToMemory();
	return persistence;
}

/**
 * IndexedDB が使えないと分かったので、その場かぎりの保存に切り替える。
 *
 * indexedDB という名前は生えているのに open すると拒否される環境がある
 * （Safari のプライベートブラウズなど）。名前の有無だけで決めると、以降の読み書きが
 * 全部失敗して画面がまったく出せなくなる。記録は残らないが、白い画面よりはよい
 * （残らないことは meta.persisted が null のままなので画面側から分かる）。
 */
function fallbackToMemory(): Persistence {
	storageUnavailable = true;
	persistence = memoryPersistence();
	return persistence;
}

/** この端末では記録が残らない（IndexedDB が使えなかった）。 */
export const isStorageUnavailable = (): boolean => storageUnavailable;

/** 保存の実体を差し替える（テスト用）。読み込み済みの内容も捨てる。 */
export function setPersistence(next: Persistence | null): void {
	persistence = next;
	loaded = null;
	loading = null;
	chain = Promise.resolve();
	storageUnavailable = false;
}

function ensureChannel(): void {
	if (channel || typeof BroadcastChannel === 'undefined') return;
	channel = new BroadcastChannel(CHANNEL);
	channel.onmessage = async () => {
		// 別のタブが書いた。手元の写しは古いので捨てる。
		loaded = null;
		loading = null;
		if (watchers.size === 0) return;
		const db = await load();
		for (const watch of watchers) watch(db);
	};
}

/** 他のタブの書き込みを受け取る（返り値を呼ぶと購読をやめる）。 */
export function watch(fn: (db: Db) => void): () => void {
	ensureChannel();
	watchers.add(fn);
	return () => watchers.delete(fn);
}

/** 保存から読む（失敗したらメモリ保存へ退避して空で始める）。 */
async function readPersisted(): Promise<Db> {
	try {
		const raw = await pickPersistence().load();
		return raw === null || raw === undefined ? emptyDb() : normalizeDb(raw);
	} catch {
		return normalizeDb(await fallbackToMemory().load());
	}
}

/** いまの内容（初回だけ保存から読む）。 */
export function load(): Promise<Db> {
	// 通路は読む前に開けておく。書いたあとに開くと、開くまでのあいだに別のタブが
	// 書いた分を取りこぼし、そのまま古い写しを書き戻して相手の変更を消してしまう。
	ensureChannel();
	if (loaded) return Promise.resolve(loaded);
	if (!loading) {
		loading = readPersisted().then((db) => {
			loaded = db;
			return db;
		});
	}
	return loading;
}

/**
 * 書き込み。fn の中でドキュメントを書き換えると、通番を上げて保存し、他のタブに知らせる。
 *
 * 直列に実行されるので、fn の中では「読んで確かめてから書く」を安全に書ける
 * （楽観ロックの revision 比較がまさにそれ）。
 *
 * 書く直前に保存から読み直すのが要点。全体を1本のドキュメントとして書き戻す作りなので、
 * 手元の写しが古いまま保存すると、別のタブが入れた記録ごと消える。読み直しは
 * IndexedDB から数ミリ秒で、書き込みは人が押したときにしか起きないので、毎回やってよい。
 */
export function mutate<T>(fn: (db: Db) => T): Promise<T> {
	const next = chain.then(async () => {
		ensureChannel();
		const db = await readPersisted();
		loaded = db;
		loading = Promise.resolve(db);
		// 通番は fn を呼ぶ**前**に上げる。あとから上げると、fn の中で
		// 「この書き込みが終わったときの通番」を知る手段が無くなる。
		// 実際それでバックアップが自分の書き込みを数えてしまい、書き出した直後に
		// 「そのあと 1件」と出ていた。
		db.meta.seq += 1;
		try {
			const result = fn(db);
			await pickPersistence().save(db);
			channel?.postMessage({ seq: db.meta.seq });
			return result;
		} catch (e) {
			// 保存しなかったのに、手元の写しだけ通番が進んだ状態になっている。
			// 次に読むときに保存から取り直させる。
			loaded = null;
			loading = null;
			throw e;
		}
	});
	// 失敗しても鎖は続ける（1回の失敗で以降の書き込みが全部詰まらないように）。
	chain = next.catch(() => undefined);
	return next;
}

/** 読み取り。書き込みの途中には割り込まない。 */
export const read = <T>(fn: (db: Db) => T): Promise<T> => load().then(fn);

/** 中身をまるごと入れ替える（バックアップからの復元）。 */
export async function replaceAll(raw: unknown): Promise<void> {
	const db = normalizeDb(raw);
	await chain;
	await pickPersistence().save(db);
	loaded = db;
	loading = Promise.resolve(db);
	ensureChannel();
	channel?.postMessage({ seq: db.meta.seq });
}

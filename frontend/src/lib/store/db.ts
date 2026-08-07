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

function pickPersistence(): Persistence {
	if (persistence) return persistence;
	// IndexedDB が使えない環境（プライベートブラウズ等）でも、その場かぎりで動かす。
	// 記録は残らないが、白い画面よりはよい。残らないことは画面側が meta.persisted で気づける。
	persistence = idbAvailable() ? idbPersistence() : memoryPersistence();
	return persistence;
}

/** 保存の実体を差し替える（テスト用）。読み込み済みの内容も捨てる。 */
export function setPersistence(next: Persistence | null): void {
	persistence = next;
	loaded = null;
	loading = null;
	chain = Promise.resolve();
}

function ensureChannel(): void {
	if (channel || typeof BroadcastChannel === 'undefined') return;
	channel = new BroadcastChannel(CHANNEL);
	channel.onmessage = async () => {
		// 別のタブが書いた。読み直して、見ている画面に知らせる。
		loaded = null;
		loading = null;
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

/** いまの内容（初回だけ保存から読む）。 */
export function load(): Promise<Db> {
	if (loaded) return Promise.resolve(loaded);
	if (!loading) {
		loading = pickPersistence()
			.load()
			.then((raw) => {
				loaded = raw === null || raw === undefined ? emptyDb() : normalizeDb(raw);
				return loaded;
			});
	}
	return loading;
}

/**
 * 書き込み。fn の中でドキュメントを書き換えると、通番を上げて保存し、他のタブに知らせる。
 *
 * 直列に実行されるので、fn の中では「読んで確かめてから書く」を安全に書ける
 * （楽観ロックの revision 比較がまさにそれ）。
 */
export function mutate<T>(fn: (db: Db) => T): Promise<T> {
	const next = chain.then(async () => {
		const db = await load();
		const result = fn(db);
		db.meta.seq += 1;
		await pickPersistence().save(db);
		ensureChannel();
		channel?.postMessage({ seq: db.meta.seq });
		return result;
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

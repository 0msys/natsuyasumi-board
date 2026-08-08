// IndexedDB への読み書き。ここだけは実機でしか確かめられないので、できるだけ短く保つ。
//
// localStorage を使わないのは、GitHub Pages が 0msys.github.io という**他のプロジェクトと
// 共有のオリジン**で配信されるため。localStorage はキー空間も 5MB のクォータも
// オリジン単位で共有されるので、同じ人の別のページが太るとこちらの書き込みが巻き添えで
// 失敗しうる。IndexedDB なら DB 名で分かれる。
import type { Persistence } from './persist';

const DB_NAME = 'natsuyasumi-board';
const DB_VERSION = 1;
const STORE = 'snapshots';
// 直前の世代を1つ残す（A/B スロット）。書き込みの途中で電源が落ちても片方は生きている。
const CURRENT = 'current';
const PREVIOUS = 'previous';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/**
 * IndexedDB は開けたのに、そのあとの読み書きが失敗した。
 *
 * 「この端末では IndexedDB が使えない」（プライベートブラウズ等で open ごと拒否される）
 * とは意味が違う。開けている以上、保存された中身は無事な見込みが高い。だから
 * 呼ぶ側は、これを理由にその場かぎりの空の保存へ切り替えてはいけない
 * （切り替えると、無事な記録を尻目に「ぜんぶ消えた」画面を出すことになる）。
 */
export class IdbTransactionError extends Error {
	/** 元の失敗（DOMException など。ログ用で、画面には出さない）。 */
	readonly reason: unknown;

	constructor(mode: IDBTransactionMode, reason: unknown) {
		super(mode === 'readonly' ? 'ほぞんを よみこめなかったよ' : 'ほぞんに かきこめなかったよ');
		this.name = 'IdbTransactionError';
		this.reason = reason;
	}
}

function run<T>(
	mode: IDBTransactionMode,
	body: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve, reject) => {
				let value: T | null = null;
				// 結末は1回だけ。リクエストが失敗するとトランザクションは中止されるので、
				// error のあとに abort も続けて飛んでくる。先に来たほうだけを採り、
				// 接続もそこで1回だけ閉じる。
				let settled = false;
				const claim = (): boolean => {
					if (settled) return false;
					settled = true;
					db.close();
					return true;
				};
				try {
					const tx = db.transaction(STORE, mode);
					const req = body(tx.objectStore(STORE));
					if (req) req.onsuccess = () => (value = req.result);
					tx.oncomplete = () => {
						if (claim()) resolve(value);
					};
					tx.onerror = (event) => {
						// 理由はイベントの出どころ（失敗したリクエスト）から取る。error は
						// リクエストから上がってくるもので、tx.error に入るのはそのあとの
						// 「中止」の段——ここで tx.error を読むと必ず null になり、
						// 容量不足なのか何なのかが分からないまま失敗だけが伝わる。
						const cause = (event.target as IDBRequest | null)?.error ?? tx.error;
						if (claim()) reject(new IdbTransactionError(mode, cause));
					};
					// abort だけが飛ぶ経路がある。リクエストの失敗を伴わない中止
					// （Safari がアイドルの接続を強制的に閉じる等）では error が来ない。
					// ここが無いと、この promise は永久に決まらないまま——db.ts の書き込みは
					// 1本の鎖に並んでいるので、以後の「やった」もタイマーも保存もそこで止まり、
					// しかも画面には成功したように見える。
					tx.onabort = () => {
						if (claim()) reject(new IdbTransactionError(mode, tx.error));
					};
				} catch (e) {
					// db.transaction() 自体が投げることがある（接続が閉じられた直後など）。
					// Promise の外へ投げると、開いた接続が閉じられないまま残る。
					if (claim()) reject(new IdbTransactionError(mode, e));
				}
			})
	);
}

export function idbPersistence(): Persistence {
	return {
		async load() {
			const current = await run<unknown>('readonly', (s) => s.get(CURRENT));
			if (current !== null && current !== undefined) return current;
			// current が読めない＝書き込みの途中で落ちた可能性。直前の世代に戻る。
			try {
				return (await run<unknown>('readonly', (s) => s.get(PREVIOUS))) ?? null;
			} catch (e) {
				// ここまで来た時点で、この端末では IndexedDB を開けている（上の読みが通った）。
				// 2回目が開けなかっただけで「使えない端末」と伝えると、呼ぶ側は無事な記録を
				// 空で塗り替えてしまう。開けたという事実のほうを残す。
				throw e instanceof IdbTransactionError ? e : new IdbTransactionError('readonly', e);
			}
		},
		async save(db) {
			const current = await run<unknown>('readonly', (s) => s.get(CURRENT));
			await run('readwrite', (s) => {
				if (current !== null && current !== undefined) s.put(current, PREVIOUS);
				s.put(db, CURRENT);
				return null;
			});
		},
		async clear() {
			await run('readwrite', (s) => {
				s.delete(CURRENT);
				s.delete(PREVIOUS);
				return null;
			});
		}
	};
}

/** この環境で IndexedDB が使えるか（Safari のプライベートブラウズ等で落ちることがある）。 */
export const idbAvailable = (): boolean =>
	typeof indexedDB !== 'undefined' && indexedDB !== null;

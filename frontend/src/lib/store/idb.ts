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

function run<T>(
	mode: IDBTransactionMode,
	body: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> {
	return openDb().then(
		(db) =>
			new Promise<T | null>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const req = body(tx.objectStore(STORE));
				let value: T | null = null;
				if (req) req.onsuccess = () => (value = req.result);
				tx.oncomplete = () => {
					db.close();
					resolve(value);
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			})
	);
}

export function idbPersistence(): Persistence {
	return {
		async load() {
			const current = await run<unknown>('readonly', (s) => s.get(CURRENT));
			if (current !== null && current !== undefined) return current;
			// current が読めない＝書き込みの途中で落ちた可能性。直前の世代に戻る。
			return (await run<unknown>('readonly', (s) => s.get(PREVIOUS))) ?? null;
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

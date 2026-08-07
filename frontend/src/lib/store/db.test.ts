// 保存層のふるまい。どれもレビューで見つかった穴なので、同じ形で戻らないように固定する。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isStorageUnavailable, load, mutate, read, replaceAll, setPersistence } from './db';
import { emptyDb, type Db } from './model';
import { memoryPersistence, type Persistence } from './persist';

/** 保存の中身を外から触れる置き場（別のタブが書いた状況を作るのに使う）。 */
function sharedPersistence(): Persistence & { peek(): unknown; poke(db: unknown): void } {
	let current: unknown = null;
	return {
		load: async () => current,
		save: async (db) => {
			current = JSON.parse(JSON.stringify(db));
		},
		clear: async () => {
			current = null;
		},
		peek: () => current,
		poke: (db) => {
			current = JSON.parse(JSON.stringify(db));
		}
	};
}

afterEach(() => setPersistence(null));

describe('別のタブの書き込みを踏み潰さない', () => {
	it('書く直前に読み直すので、あいだに入った変更が残る', async () => {
		const store = sharedPersistence();
		setPersistence(store);

		// このタブが1回書いて、写しを手元に持った状態にする
		await mutate((db) => {
			db.flags['A'] = { value: 1, decision: null, updated_at: 0 };
		});
		expect(await read((db) => Object.keys(db.flags))).toEqual(['A']);

		// 別のタブが書いた、という状況を作る（保存だけが進み、手元の写しは古いまま）
		const outside = JSON.parse(JSON.stringify(store.peek())) as Db;
		outside.flags['B'] = { value: 1, decision: null, updated_at: 0 };
		outside.meta.seq += 1;
		store.poke(outside);

		// このタブがもう一度書く。古い写しを書き戻すと B が消える。
		await mutate((db) => {
			db.flags['C'] = { value: 1, decision: null, updated_at: 0 };
		});

		const keys = Object.keys((store.peek() as Db).flags).sort();
		expect(keys, '別のタブが入れた B が消えている').toEqual(['A', 'B', 'C']);
	});
});

describe('IndexedDB が使えないとき', () => {
	beforeEach(() => {
		setPersistence({
			// 名前は生えているのに open が拒否される環境（プライベートブラウズ等）を模す
			load: async () => {
				throw new Error('保存にアクセスできません');
			},
			save: async () => {},
			clear: async () => {}
		});
	});

	it('読めなくても、その場かぎりの保存に切り替えて動く', async () => {
		const db = await load();
		expect(db).toEqual(emptyDb());
		expect(isStorageUnavailable(), '記録が残らないことを画面側が知れる').toBe(true);

		// 書き込みも通る（この端末では残らないが、白い画面にはしない）
		await mutate((d) => {
			d.flags['A'] = { value: 1, decision: null, updated_at: 0 };
		});
		expect(await read((d) => d.flags['A'].value)).toBe(1);
	});
});

describe('タブをまたぐ書き込みの直列化', () => {
	// 本当の競合は別タブが要るので、ここで確かめられるのは「鍵を通っているか」まで。
	// 同じタブの中は chain が直列にするので、鍵が外れても在庫のテストは通ってしまう
	// ——だからこそ、通っていること自体を見ておく。
	it('書き込みは Web Locks を通る', async () => {
		const taken: string[] = [];
		const original = (navigator as { locks?: unknown }).locks;
		Object.defineProperty(navigator, 'locks', {
			configurable: true,
			value: {
				request: async (name: string, cb: () => Promise<unknown>) => {
					taken.push(name);
					return cb();
				}
			}
		});
		try {
			setPersistence(memoryPersistence());
			await mutate((db) => {
				db.flags['A'] = { value: 1, decision: null, updated_at: 0 };
			});
			await mutate((db) => {
				db.flags['B'] = { value: 1, decision: null, updated_at: 0 };
			});
			expect(taken, '読み書きが鍵の外で行われている').toEqual(['nyb-write', 'nyb-write']);
		} finally {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: original });
		}
	});

	it('Web Locks が無い端末でも書ける（鍵が取れないなら鍵なしで進む）', async () => {
		const original = (navigator as { locks?: unknown }).locks;
		Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		try {
			setPersistence(memoryPersistence());
			await mutate((db) => {
				db.flags['A'] = { value: 1, decision: null, updated_at: 0 };
			});
			expect(await read((db) => db.flags['A'].value)).toBe(1);
		} finally {
			Object.defineProperty(navigator, 'locks', { configurable: true, value: original });
		}
	});
});

describe('まるごと復元', () => {
	/** 読み書きに時間がかかる保存。
	 *
	 *  読みは「始めた時点の中身」を掴んで、あとから返す（IndexedDB の読み取りと同じ）。
	 *  ここを「終わった時点」にすると、割り込みの窓が消えてテストが競合を作れない。 */
	function slowPersistence(delayMs = 20): Persistence {
		let current: unknown = null;
		const wait = () => new Promise((r) => setTimeout(r, delayMs));
		return {
			load: async () => {
				const snapshot = current;
				await wait();
				return snapshot;
			},
			save: async (db) => {
				await wait();
				current = JSON.parse(JSON.stringify(db));
			},
			clear: async () => {
				current = null;
			}
		};
	}

	it('あとから始まった書き込みに踏み潰されない', async () => {
		setPersistence(slowPersistence());
		await mutate((db) => {
			db.flags['もとから'] = { value: 1, decision: null, updated_at: 0 };
		});

		// 復元したい中身（別の端末で取ったバックアップのつもり）
		const restored = emptyDb();
		restored.flags['もどした'] = { value: 1, decision: null, updated_at: 0 };

		const restoring = replaceAll(restored);
		// 復元が「列の順番待ち」を終えたあと、保存し終える前に別の書き込みが始まる状況。
		// バックアップの状態を見にいくと、裏で「保存の持続を聞いた結果」がこの形で走る。
		await Promise.resolve();
		await Promise.resolve();
		const background = mutate((db) => {
			db.meta.persisted = true;
		});
		await Promise.all([restoring, background]);

		const db = await read((d) => d);
		expect(Object.keys(db.flags), '復元した中身が、あとの書き込みに消された').toContain('もどした');
		expect(Object.keys(db.flags), '復元したのに前の記録が残っている').not.toContain('もとから');
		expect(db.meta.persisted, '並んだ書き込みのほうが消えた').toBe(true);
	});
});

// 保存層のふるまい。どれもレビューで見つかった穴なので、同じ形で戻らないように固定する。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isStorageUnavailable, load, mutate, read, setPersistence } from './db';
import { emptyDb, type Db } from './model';
import type { Persistence } from './persist';

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

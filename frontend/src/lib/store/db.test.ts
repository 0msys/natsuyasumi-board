// 保存層のふるまい。どれもレビューで見つかった穴なので、同じ形で戻らないように固定する。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { isStorageUnavailable, load, mutate, read, replaceAll, setPersistence } from './db';
import { IdbTransactionError } from './idb';
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

describe('読み込みが一時的に失敗したとき', () => {
	/** 読みだけを狙って失敗させられる保存（保存された中身はそのまま無事）。 */
	function flakyPersistence(): Persistence & {
		peek(): unknown;
		poke(db: unknown): void;
		fail(times: number, error?: unknown): void;
	} {
		let current: unknown = null;
		let failures = 0;
		let error: unknown = new Error('接続が閉じられました');
		return {
			load: async () => {
				if (failures > 0) {
					failures -= 1;
					throw error;
				}
				return current;
			},
			save: async (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			clear: async () => {
				current = null;
			},
			peek: () => current,
			poke: (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			fail: (times, e) => {
				failures = times;
				if (e !== undefined) error = e;
			}
		};
	}

	const flag = () => ({ value: 1, decision: null, updated_at: 0 });

	it('1回転んだだけなら読み直す（開き直せば通ることがある）', async () => {
		const store = flakyPersistence();
		setPersistence(store);
		await mutate((db) => {
			db.flags['A'] = flag();
		});

		store.fail(1);
		await mutate((db) => {
			db.flags['B'] = flag();
		});

		expect(Object.keys((store.peek() as Db).flags).sort()).toEqual(['A', 'B']);
	});

	it('一度読めた端末なら、読めなくなっても空の保存に切り替えない', async () => {
		const store = flakyPersistence();
		setPersistence(store);
		await mutate((db) => {
			db.flags['A'] = flag();
		});

		// ここから読めない。空へ退避すると、この書き込みは「成功」して消える。
		store.fail(99);
		await expect(
			mutate((db) => {
				db.flags['B'] = flag();
			})
		).rejects.toThrow();

		expect(isStorageUnavailable(), '一時的な失敗で「記録が残らない端末」にされた').toBe(false);
		expect(Object.keys((store.peek() as Db).flags), '無事な保存が空で塗り替えられた').toEqual(['A']);
		expect(await read((db) => Object.keys(db.flags)), '画面から記録が消えた').toEqual(['A']);
	});

	it('起動時に開けなくても、開けるようになったら退避を差し戻す', async () => {
		const store = flakyPersistence();
		const seeded = emptyDb();
		seeded.flags['A'] = flag();
		store.poke(seeded);
		store.fail(99); // 起動時は開けない（プライベートブラウズか、一時的な詰まりか分からない）
		setPersistence(store);

		expect(await read((db) => Object.keys(db.flags)), '開けないので、いったんは空で始まる').toEqual(
			[]
		);
		expect(isStorageUnavailable()).toBe(true);

		// 詰まりが解けた。まだ1件も書いていないので、戻しても何も失わない。
		store.fail(0);
		expect(
			await read((db) => Object.keys(db.flags)),
			'空のまま固まっている（以後の記録はタブを閉じたら消える）'
		).toEqual(['A']);
		expect(isStorageUnavailable(), '差し戻したのに「記録が残らない端末」のまま').toBe(false);
	});

	it('退避先に書いたあとは差し戻さない（いま書いたものが消える）', async () => {
		const store = flakyPersistence();
		const seeded = emptyDb();
		seeded.flags['A'] = flag();
		store.poke(seeded);
		store.fail(99);
		setPersistence(store);

		await read((db) => db); // 空で始まる
		await mutate((db) => {
			db.flags['B'] = flag();
		}); // 退避先に書いた

		store.fail(0);
		expect(await read((db) => Object.keys(db.flags)), 'いま書いたものが消えた').toEqual(['B']);
		expect(isStorageUnavailable(), '残らないことを画面側が知れなくなった').toBe(true);
	});

	it('差し戻しは書き込みと入れ替わらない（同じ列に並ぶ）', async () => {
		// 差し戻しの最中に書き込みが割り込めると、その書き込みは差し替え前の保存へ落ち、
		// 差し戻した先には無い＝たったいま残した1件だけが消える。「書き込み中か」の
		// フラグで狭めるだけでは、読み終わってからフラグを立てるまでの隙に割り込まれる。
		// ここでは隙そのものが無いこと——列に並ぶこと——を見る。
		const log: string[] = [];
		let release = () => {};
		// 読みの応答を順番に決める。'hold' は、こちらが放すまで返さない差し戻しの読み。
		const plan: ('fail' | 'hold')[] = ['fail', 'fail', 'hold'];
		let current: unknown = null;
		const store: Persistence = {
			load: async () => {
				const step = plan.shift();
				if (step === 'fail') throw new Error('ひらけない');
				const snapshot = current;
				if (step === 'hold') await new Promise<void>((r) => (release = () => r()));
				return snapshot;
			},
			save: async (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			clear: async () => {
				current = null;
			}
		};
		const seeded = emptyDb();
		seeded.flags['A'] = flag();
		current = JSON.parse(JSON.stringify(seeded));
		setPersistence(store);

		await read((db) => db); // 起動時は開けない → 空へ退避

		const probing = read((db) => Object.keys(db.flags)); // 差し戻しの読みが止まる
		const writing = mutate((db) => {
			log.push('write');
			db.flags['B'] = flag();
		});
		for (let i = 0; i < 30; i += 1) await Promise.resolve(); // 割り込めるならここで割り込む

		expect(log, '差し戻しの最中に書き込みが割り込んだ（その1件が置き去りになる）').toEqual([]);

		release();
		await Promise.all([probing, writing]);

		expect(log).toEqual(['write']);
		expect(
			await read((db) => Object.keys(db.flags).sort()),
			'差し戻したのに、そのあとの書き込みが残っていない'
		).toEqual(['A', 'B']);
	});

	it('再試行の途中で一度でも開けていたら、その事実を捨てない', async () => {
		// 1回目は「開けたのに転んだ」、2回目は開けもしなかった。最後の1回だけを見ると
		// 「使えない端末」に見えるが、1回目に開けている以上、中身は無事。空にしてはいけない。
		const errors: unknown[] = [new IdbTransactionError('readonly', null), new Error('ひらけない')];
		const store: Persistence = {
			load: async () => {
				throw errors.shift() ?? new Error('ひらけない');
			},
			save: async () => {},
			clear: async () => {}
		};
		setPersistence(store);

		await expect(load()).rejects.toBeInstanceOf(IdbTransactionError);
		expect(isStorageUnavailable(), '開けた事実を捨てて「記録が残らない端末」にした').toBe(false);
	});

	it('差し戻しで「開けた」と分かったら、退避先へ書き続けない', async () => {
		// 差し戻しの読みが IdbTransactionError＝開けはした、ということ。この端末では使えない
		// という見立てのほうが間違っていた。それでも退避先へ書き続けると、元の記録は
		// IndexedDB に、これから書く記録はメモリに、と離ればなれになる。
		const plan: ('ひらけない' | 'ひらけたが読めない' | 'ok')[] = [
			'ひらけない',
			'ひらけない', // 起動時 → 空へ退避
			'ひらけたが読めない' // 差し戻しの読み
		];
		let current: unknown = null;
		const store: Persistence = {
			load: async () => {
				const step = plan.shift() ?? 'ok';
				if (step === 'ひらけない') throw new Error('ひらけない');
				if (step === 'ひらけたが読めない') throw new IdbTransactionError('readonly', null);
				return current;
			},
			save: async (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			clear: async () => {
				current = null;
			}
		};
		const seeded = emptyDb();
		seeded.flags['A'] = flag();
		current = JSON.parse(JSON.stringify(seeded));
		setPersistence(store);

		await read((db) => db); // 起動時は開けない → 空へ退避

		// 次の書き込みは、退避先へ黙って書かずに失敗する
		await expect(
			mutate((db) => {
				db.flags['B'] = flag();
			}),
			'開けたと分かったのに、消える場所へ黙って書いた'
		).rejects.toBeInstanceOf(IdbTransactionError);
		expect(isStorageUnavailable(), '開けたのに「記録が残らない端末」のまま').toBe(false);

		// 本物へ戻っているので、読めるようになれば元の記録が出る
		expect(await read((db) => Object.keys(db.flags))).toEqual(['A']);
	});

	it('一度「開けた」と分かったら、そのあと開けなくなっても空へ退避しない', async () => {
		// 差し戻しで開けたことが分かったのに、それを覚えずにいると、次に open が転んだ拍子に
		// また空へ退避する。そこへ書けば、元の記録（IndexedDB）と離ればなれになる。
		const plan: ('ひらけない' | 'ひらけたが読めない')[] = [
			'ひらけない',
			'ひらけない', // 起動時 → 空へ退避
			'ひらけたが読めない' // 差し戻しの読み → ここで「使える端末」だと分かる
			// 以降はまた開けない（既定）
		];
		const store: Persistence = {
			load: async () => {
				const step = plan.shift() ?? 'ひらけない';
				if (step === 'ひらけたが読めない') throw new IdbTransactionError('readonly', null);
				throw new Error('ひらけない');
			},
			save: async () => {},
			clear: async () => {}
		};
		setPersistence(store);

		await read((db) => db); // 空へ退避
		await expect(mutate(() => {})).rejects.toBeInstanceOf(IdbTransactionError); // 開けたと分かる

		// また開けなくなった。それでも空へ退避せず、失敗は失敗のまま返す。
		await expect(
			mutate((db) => {
				db.flags['B'] = flag();
			}),
			'消える場所へ黙って書いた（元の記録と離ればなれになる）'
		).rejects.toThrow();
		expect(isStorageUnavailable(), 'また「記録が残らない端末」に落ちた').toBe(false);
	});

	it('通常の読みで「開けた」と分かったときも、その事実を覚える', async () => {
		// 起動時の読みが「開けたが読めない」で終わった＝この端末では IndexedDB が使える。
		// そのあと開けなくなっても、空へ退避してはいけない（元の記録と離ればなれになる）。
		const plan: ('ひらけたが読めない' | 'ひらけない')[] = [
			'ひらけたが読めない',
			'ひらけたが読めない' // 起動時の読み（再試行ぶん）
			// 以降はもう開けもしない（既定）
		];
		const store: Persistence = {
			load: async () => {
				const step = plan.shift() ?? 'ひらけない';
				if (step === 'ひらけたが読めない') throw new IdbTransactionError('readonly', null);
				throw new Error('ひらけない');
			},
			save: async () => {},
			clear: async () => {}
		};
		setPersistence(store);

		await expect(load()).rejects.toBeInstanceOf(IdbTransactionError);

		await expect(load(), '消える場所へ黙って切り替えた').rejects.toThrow();
		expect(isStorageUnavailable(), 'また「記録が残らない端末」に落ちた').toBe(false);
	});

	it('開けたのに読めなかったときは、まだ一度も読めていなくても空にしない', async () => {
		const store = flakyPersistence();
		store.fail(99, new IdbTransactionError('readonly', null));
		setPersistence(store);

		await expect(load()).rejects.toBeInstanceOf(IdbTransactionError);

		expect(isStorageUnavailable(), '中身は無事なのに「記録が残らない端末」にされた').toBe(false);

		// 失敗を覚え込まない（生き返ったら読み直す）
		const seeded = emptyDb();
		seeded.flags['A'] = flag();
		store.poke(seeded);
		store.fail(0);
		expect(await read((db) => Object.keys(db.flags)), '一度の失敗を覚えたまま読みにいかない').toEqual([
			'A'
		]);
	});
});

describe('遅れて返ってきた読み', () => {
	/** 読みは「始めた時点の中身」を掴み、指定したぶんだけ待ってから返す。 */
	function stagedPersistence(): Persistence & {
		poke(db: unknown): void;
		delayNext(ms: number): void;
	} {
		let current: unknown = null;
		const delays: number[] = [];
		return {
			load: async () => {
				const snapshot = current;
				const ms = delays.shift() ?? 0;
				if (ms) await new Promise((r) => setTimeout(r, ms));
				return snapshot;
			},
			save: async (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			clear: async () => {
				current = null;
			},
			poke: (db) => {
				current = JSON.parse(JSON.stringify(db));
			},
			delayNext: (ms) => delays.push(ms)
		};
	}

	it('あいだに済んだ書き込みを巻き戻さない', async () => {
		const store = stagedPersistence();
		const seeded = emptyDb();
		seeded.flags['A'] = { value: 1, decision: null, updated_at: 0 };
		store.poke(seeded);
		setPersistence(store);

		// 遅い読みの最中に書き込みが済む状況。再試行が入ると読みの寿命は伸びるので、
		// 「保存が一時的に転ぶ」ときほどこの追い越しが起きやすい。
		store.delayNext(50);
		const slow = read((db) => Object.keys(db.flags));
		await mutate((db) => {
			db.flags['B'] = { value: 1, decision: null, updated_at: 0 };
		});
		expect(await slow, '遅い読みが掴むのは書き込み前の写し').toEqual(['A']);

		expect(
			await read((db) => Object.keys(db.flags).sort()),
			'遅れて返った読みが手元の写しを巻き戻した（次の書き込みが保存を上書きする）'
		).toEqual(['A', 'B']);
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

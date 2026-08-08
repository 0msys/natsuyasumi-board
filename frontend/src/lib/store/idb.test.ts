// トランザクションの結末の受け取り方。
//
// 実物の IndexedDB は実機でしか動かないので、ここでは最小の偽物を置いて
// 「どう終わっても promise が必ず決まるか」「開いた接続を必ず閉じるか」
// 「失敗の理由を運べているか」だけを見る。
//
// とくに abort。リクエストの失敗を伴わない中止（Safari がアイドルの接続を強制的に
// 閉じる等）では error が飛ばないので、abort を拾い損ねると promise は永久に決まらない。
// db.ts の書き込みは1本の鎖に並んでいるため、そこで止まると以後の「やった」もタイマーも
// 保存も——画面には成功したまま——ひとつも残らなくなる。
import { afterEach, describe, expect, it } from 'bun:test';
import { IdbTransactionError, idbAvailable, idbPersistence } from './idb';

type EventLike = { target: unknown };
type Handler = ((event: EventLike) => void) | null;
type FakeRequest = { onsuccess: Handler; onerror: Handler; result: unknown; error: unknown };
type FakeStore = { get(key: string): FakeRequest; put(): object; delete(): object };
type FakeTx = {
	error: unknown;
	oncomplete: Handler;
	onerror: Handler;
	onabort: Handler;
	objectStore(): FakeStore;
};

/** トランザクションの終わり方。`throw` は transaction() 自体が投げる（接続が閉じた直後）。 */
type Outcome = 'complete' | 'error' | 'abort' | 'throw';

/** 失敗の理由（実機なら QuotaExceededError などの DOMException）。 */
const CAUSE = Object.assign(new Error('容量が足りません'), { name: 'QuotaExceededError' });

/**
 * 最小の偽 IndexedDB。open は必ず通り、そのあとの結末だけを指定する。
 *
 * 発火の順と値は実物に合わせてある。とくに error の経路——リクエストの失敗は
 * 「リクエストで error を出す」→「そのあとトランザクションを中止する」の順で進み、
 * tx.error に理由が入るのは後半。だから onerror の時点では tx.error はまだ null で、
 * 理由は event.target（失敗したリクエスト）にしか無い。ここを実物とずらすと、
 * 「テストだけ通る」実装を素通しさせてしまう。
 */
function fakeIndexedDb(outcome: Outcome, stored: Record<string, unknown> = {}, opensOk = Infinity) {
	let closes = 0;
	let opens = 0;
	const database = {
		objectStoreNames: { contains: () => true },
		createObjectStore: () => {},
		close: () => {
			closes += 1;
		},
		transaction: () => {
			if (outcome === 'throw') throw new Error('接続が閉じています');
			let request: FakeRequest | null = null;
			const tx: FakeTx = {
				error: null,
				oncomplete: null,
				onerror: null,
				onabort: null,
				objectStore: () => ({
					get: (key: string) => {
						const req: FakeRequest = {
							onsuccess: null,
							onerror: null,
							result: stored[key],
							error: null
						};
						request = req;
						if (outcome === 'complete') queueMicrotask(() => req.onsuccess?.({ target: req }));
						return req;
					},
					put: () => ({}),
					delete: () => ({})
				})
			};
			// 結末はハンドラが付いたあと、さらにリクエストの onsuccess が流れたあとに出す。
			queueMicrotask(() =>
				queueMicrotask(() => {
					if (outcome === 'complete') {
						tx.oncomplete?.({ target: tx });
						return;
					}
					if (outcome === 'error') {
						// リクエストで error（この時点の tx.error はまだ null）
						if (request) request.error = CAUSE;
						tx.onerror?.({ target: request });
					}
					// 中止。理由が tx.error に入るのはここ。
					tx.error = CAUSE;
					tx.onabort?.({ target: tx });
				})
			);
			return tx;
		}
	};
	return {
		idb: {
			open: () => {
				opens += 1;
				const req: FakeRequest & { onupgradeneeded: Handler } = {
					onsuccess: null,
					onerror: null,
					onupgradeneeded: null,
					result: database,
					error: null
				};
				// opensOk 回までは開ける。それ以降は open ごと拒否される端末を模す。
				if (opens > opensOk) {
					req.error = new Error('ひらけない');
					queueMicrotask(() => req.onerror?.({ target: req }));
					return req;
				}
				queueMicrotask(() => req.onsuccess?.({ target: req }));
				return req;
			}
		},
		closes: () => closes
	};
}

function install(idb: unknown): void {
	Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb });
}

const original = (globalThis as { indexedDB?: unknown }).indexedDB;
afterEach(() => install(original));

describe('トランザクションがどう終わっても promise は決まる', () => {
	it('完了したら中身を返し、接続を閉じる', async () => {
		const fake = fakeIndexedDb('complete', { current: { hello: 1 } });
		install(fake.idb);

		expect(await idbPersistence().load()).toEqual({ hello: 1 });
		expect(fake.closes(), '接続が開きっぱなし').toBe(1);
	});

	it('abort だけが飛んでも決まる（永久に待たない）', async () => {
		const fake = fakeIndexedDb('abort');
		install(fake.idb);

		// 決まらないと await ごと止まってしまうので、時間で打ち切って形を見る
		const result = await Promise.race([
			idbPersistence()
				.load()
				.then(
					() => '成功してしまった',
					(e: unknown) => e
				),
			new Promise((r) => setTimeout(() => r('promise が決まらないまま'), 200))
		]);
		expect(result).toBeInstanceOf(IdbTransactionError);
		expect(fake.closes(), '接続が開きっぱなし').toBe(1);
	});

	it('error のあとに abort が続いても、結末は1回だけ', async () => {
		const fake = fakeIndexedDb('error');
		install(fake.idb);

		await expect(idbPersistence().load()).rejects.toBeInstanceOf(IdbTransactionError);
		expect(fake.closes(), '接続を二度閉じている').toBe(1);
	});

	it('transaction() が投げても、接続を閉じてから返す', async () => {
		const fake = fakeIndexedDb('throw');
		install(fake.idb);

		await expect(idbPersistence().load()).rejects.toBeInstanceOf(IdbTransactionError);
		expect(fake.closes(), '開いた接続が閉じられずに残る').toBe(1);
	});
});

describe('失敗の理由を運ぶ', () => {
	// 「静かに消える」たぐいの障害を実機で切り分けるとき、容量不足なのか中止なのかは
	// これしか手がかりが無い。onerror の時点の tx.error（まだ null）を掴むと、
	// いちばんよく通る経路で理由が空になる。
	const reasonOf = async (outcome: Outcome) => {
		const fake = fakeIndexedDb(outcome);
		install(fake.idb);
		const e = await idbPersistence()
			.load()
			.catch((err: unknown) => err);
		expect(e).toBeInstanceOf(IdbTransactionError);
		return (e as IdbTransactionError).reason;
	};

	it('リクエストが失敗したとき', async () => {
		expect(await reasonOf('error')).toBe(CAUSE);
	});

	it('トランザクションが中止されたとき', async () => {
		expect(await reasonOf('abort')).toBe(CAUSE);
	});
});

describe('この端末で使えるか', () => {
	it('直前の世代を見にいく2回目だけ開けなくても、「使えない端末」ではない', async () => {
		// current が空なら previous を見にいく。その2回目だけ open が拒否される状況。
		// 1回目が開けている以上この端末では使えるので、呼ぶ側が「使えない端末」と
		// 受け取って空で塗り替えないよう、開けたという事実のほうを伝える。
		const fake = fakeIndexedDb('complete', {}, 1);
		install(fake.idb);

		await expect(idbPersistence().load()).rejects.toBeInstanceOf(IdbTransactionError);
	});


	it('indexedDB が生えていなければ使えないと分かる', () => {
		install(undefined);
		expect(idbAvailable()).toBe(false);
	});
});

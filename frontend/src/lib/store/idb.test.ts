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
import { StaleWriteError } from './persist';

type EventLike = { target: unknown };
type Handler = ((event: EventLike) => void) | null;
type FakeRequest = { onsuccess: Handler; onerror: Handler; result: unknown; error: unknown };
type FakeStore = {
	get(key: string): FakeRequest;
	put(value: unknown, key: string): object;
	delete(): object;
};
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
	/** 開いたトランザクションの種別。読みと書きを分けていないかを見るのに使う。 */
	const modes: string[] = [];
	/** 書き込んだもの（キーと中身）。 */
	const puts: { key: string; value: unknown }[] = [];
	const database = {
		objectStoreNames: { contains: () => true },
		createObjectStore: () => {},
		close: () => {
			closes += 1;
		},
		transaction: (_store: string, mode: string) => {
			if (outcome === 'throw') throw new Error('接続が閉じています');
			modes.push(mode);
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
					put: (value: unknown, key: string) => {
						puts.push({ key, value });
						return {};
					},
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
		closes: () => closes,
		modes: () => modes,
		puts: () => puts
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

describe('書き戻す前に、もとにしたものと突き合わせる', () => {
	// タブをまたぐ守りは Web Locks だが、無い端末（Safari 15.4 より前。お下がりの iPad は
	// まさにこのアプリの想定）では鍵なしで進む。そこで記録が消えないかどうかは、
	// この突き合わせが「読みと同じトランザクションの中」にあるかどうかで決まる。
	const doc = (seq: number, mark: string) => ({ meta: { seq }, mark });

	it('もとにしたままなら、直前の世代を送ってから書く', async () => {
		const fake = fakeIndexedDb('complete', { current: doc(3, 'ふるい') });
		install(fake.idb);

		await idbPersistence().save(doc(4, 'あたらしい'), 3);

		expect(fake.puts()).toEqual([
			{ key: 'previous', value: doc(3, 'ふるい') },
			{ key: 'current', value: doc(4, 'あたらしい') }
		]);
	});

	it('読みと書きが1つのトランザクションに入っている', async () => {
		// 読んでから別のトランザクションで書くと、その2つのあいだが丸ごと隙になる。
		// 別のタブの書き込みはそこに入るので、分けないことが守りの本体。
		const fake = fakeIndexedDb('complete', { current: doc(3, 'ふるい') });
		install(fake.idb);

		await idbPersistence().save(doc(4, 'あたらしい'), 3);

		expect(fake.modes(), '読みと書きが分かれている（あいだに割り込まれる）').toEqual(['readwrite']);
	});

	it('先を越されていたら書かない', async () => {
		const fake = fakeIndexedDb('complete', { current: doc(9, 'ほかのタブ') });
		install(fake.idb);

		await expect(idbPersistence().save(doc(4, 'こちら'), 3)).rejects.toBeInstanceOf(StaleWriteError);
		expect(fake.puts(), '別のタブが入れた記録を踏み潰した').toEqual([]);
	});

	it('まだ何も入っていなければ書ける', async () => {
		const fake = fakeIndexedDb('complete', {});
		install(fake.idb);

		await idbPersistence().save(doc(1, 'さいしょ'), 0);

		expect(fake.puts(), '直前の世代が無いのに送ろうとした').toEqual([
			{ key: 'current', value: doc(1, 'さいしょ') }
		]);
	});

	it('通番の読めない中身が入っていても止めない', async () => {
		// 読む側はそれを seq 0 として受け取るので、ここで止めるとやり直しの読み直しでも
		// 同じところで止まる＝その端末では以後1件も書けない（いちばん書き足したいときに）。
		const fake = fakeIndexedDb('complete', { current: { こわれている: true } });
		install(fake.idb);

		await idbPersistence().save(doc(1, 'あたらしい'), 0);

		expect(fake.puts().map((p) => p.key)).toEqual(['previous', 'current']);
	});

	it('書き込みが転んだときは、やり直しの合図にしない', async () => {
		// 「先を越された」にしてしまうと、書けない端末で mutate が何度も読み直したうえで、
		// 容量不足などの本当の理由を落として伝えることになる。
		const fake = fakeIndexedDb('error', { current: doc(3, 'ふるい') });
		install(fake.idb);

		await expect(idbPersistence().save(doc(4, 'あたらしい'), 3)).rejects.toBeInstanceOf(
			IdbTransactionError
		);
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

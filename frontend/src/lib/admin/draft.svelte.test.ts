// ドラフトが「編集中の年」を保つことの回帰テスト。
//
// 年をまたいで定義を持てるようになったため、保存・読み直しで year を落とすと
// サーバ側の既定年（＝いま子どもページに出ている年）に書いてしまう。
// 2027年ぶんを直したつもりが2026年ぶんを上書きする、という取り返しのつかない事故になる。
import { beforeEach, describe, expect, it } from 'bun:test';
import { setApi } from '../../test-support/apiMock';

// $lib/api の差し替えが済んでから読む（静的 import だと本物の fetch を掴む）
const { AdminDraft } = await import('./draft.svelte');

const ENTRY_2027 = {
	child: 'はな',
	year: 2027,
	years: [2026, 2027],
	revision: 3,
	updated_at: 0,
	doc: { child: 'はな', year: 2027, grade: '小3' }
};

let saveArgs: unknown[] = [];
let getArgs: unknown[] = [];

beforeEach(() => {
	saveArgs = [];
	getArgs = [];
	setApi({
		adminValidateDefinition: () => Promise.resolve({ ok: true, errors: [], warnings: [] }),
		adminSaveDefinition: (...args: unknown[]) => {
			saveArgs = args;
			return Promise.resolve({ ...ENTRY_2027, revision: 4 });
		},
		adminGetDefinition: (...args: unknown[]) => {
			getArgs = args;
			return Promise.resolve(ENTRY_2027);
		}
	});
});

describe('AdminDraft の年', () => {
	it('initFrom で年と年の一覧を持つ', () => {
		const draft = new AdminDraft();
		draft.initFrom(ENTRY_2027);
		expect(draft.year).toBe(2027);
		expect(draft.years).toEqual([2026, 2027]);
	});

	it('years が無い応答でも編集中の年だけは持つ（古い API 応答の保険）', () => {
		const draft = new AdminDraft();
		draft.initFrom({ ...ENTRY_2027, years: undefined as unknown as number[] });
		expect(draft.years).toEqual([2027]);
	});

	it('保存は編集中の年あてに送る', async () => {
		const draft = new AdminDraft();
		draft.initFrom(ENTRY_2027);
		expect(await draft.save()).toBe(true);
		expect(saveArgs[0]).toBe('はな');
		expect(saveArgs[2]).toBe(3); // revision
		expect(saveArgs[3]).toBe(2027); // year を落とすと別の年を上書きしうる
	});

	it('読み直しも編集中の年のまま', async () => {
		const draft = new AdminDraft();
		draft.initFrom(ENTRY_2027);
		await draft.load('はな');
		expect(getArgs).toEqual(['はな', 2027]);
	});

	it('年を知らない状態（初回ロード）は年を指定しない＝サーバが今の年を選ぶ', async () => {
		const draft = new AdminDraft();
		await draft.load('はな');
		expect(getArgs).toEqual(['はな', undefined]);
	});
});

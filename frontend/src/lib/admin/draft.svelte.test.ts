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

// 検証は画面を開いた時点でも1本走るようになったので、保存や年の切替と同時に飛ぶことがある。
// 応答が順不同で返るのは「遅い1本目」と「速い2本目」が並ぶだけで珍しくないのに、書き戻しに
// 順序の守りが無いと、古い応答が新しい結果を黙って消す＝画面が嘘をつく。
describe('検証の応答が追い越されたとき', () => {
	/** 手で解決できる検証。resolve(n) で n 本目の応答を返す. */
	function deferredValidate() {
		const pending: ((r: unknown) => void)[] = [];
		setApi({
			adminValidateDefinition: () => new Promise((res) => pending.push(res)),
			adminSaveDefinition: () => Promise.resolve({ ...ENTRY_2027, revision: 4 })
		});
		return {
			resolve(i: number, issues: { errors?: unknown[]; warnings?: unknown[] }) {
				pending[i]({ ok: !issues.errors?.length, errors: [], warnings: [], ...issues });
			}
		};
	}

	const warn = (code: string) => ({ path: '/habits', code, message: code, detail: {} });

	it('古い応答は、新しい応答の結果を上書きしない', async () => {
		const api = deferredValidate();
		const draft = new AdminDraft();
		draft.initFrom(ENTRY_2027);

		const first = draft.validate(); // 開いた時点の検証（遅い）
		const second = draft.validate(); // そのあとの保存ぶん（速い）
		api.resolve(1, { warnings: [warn('新しい')] });
		await second;
		api.resolve(0, { warnings: [warn('古い')] });
		await first;

		expect(draft.warnings.map((w) => w.code)).toEqual(['新しい']);
		expect(draft.validating).toBe(false);
	});

	it('別の年に切り替えたら、前の年ぶんの応答は捨てる', async () => {
		const api = deferredValidate();
		const draft = new AdminDraft();
		draft.initFrom(ENTRY_2027);

		const pendingFor2027 = draft.validate();
		draft.initFrom({ ...ENTRY_2027, year: 2026 }); // 年タブで切り替えた
		api.resolve(0, { warnings: [warn('2027年ぶん')] });
		await pendingFor2027;

		expect(draft.warnings).toEqual([]);
		expect(draft.validating).toBe(false);
	});
});

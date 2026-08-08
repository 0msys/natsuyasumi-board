// 入口の振り分け。
//
// 「保存が読めなかった」と「まだ何も登録していない」は、load から見ると同じ“子どもゼロ人”に
// 見える。混ぜると、夏休みぶんの記録がある子を初回ウィザードへ流してしまう——保存が一瞬
// 読めなかっただけかもしれないのに「ようこそ」から始めさせることになる（保存層がその1回で
// 空へ退避しなくなった今、この分岐がその症状の最後の砦）。読むだけでは区別が付かないので、
// 両方の枝をここで固定する。
import { beforeEach, describe, expect, it } from 'bun:test';
import { setApi } from '../test-support/apiMock';
import '../test-support/appMocks'; // load が $app/paths（resolve）を使うので差し替えが要る

const { load } = await import('./+page');

const CHILDREN = [{ child: 'はな', year: 2026, grade: '小2', valid: true }];

type Loaded = { children: unknown[]; child: string; summer: { child?: string } | null };

/** load を呼んで、返り値かリダイレクト先かを見分ける（redirect() は投げて伝わる）。 */
async function runLoad(
	search = ''
): Promise<{ data: Loaded | null; redirect: string | null }> {
	const url = new URL(`http://localhost/${search}`);
	try {
		return { data: (await load({ url } as never)) as Loaded, redirect: null };
	} catch (e) {
		const thrown = e as { location?: unknown };
		if (typeof thrown?.location === 'string') return { data: null, redirect: thrown.location };
		throw e;
	}
}

describe('入口の振り分け', () => {
	beforeEach(() => setApi({}));

	it('読めなかったときは、初回ウィザードへ流さない', async () => {
		setApi({
			summerChildren: async () => {
				throw new Error('ほぞんを よみこめなかったよ');
			}
		});

		const { data, redirect } = await runLoad('?child=はな');

		expect(redirect, '記録があるかもしれない子を「ようこそ」へ飛ばしている').toBeNull();
		expect(data?.summer, 'ページ側の「よみこめなかった」表示に落とす').toBeNull();
		expect(data?.children).toEqual([]);
		expect(data?.child, '誰の画面だったかは URL から残す').toBe('はな');
	});

	it('本当に定義がゼロなら、今までどおり初回ウィザードへ', async () => {
		setApi({ summerChildren: async () => ({ children: [] }) });

		const { redirect } = await runLoad();

		expect(redirect, '直しすぎて、初めての人が登録画面へ行けなくなっている').toBe('/admin/new');
	});

	it('定義があれば、その子の state を添えて返す', async () => {
		setApi({
			summerChildren: async () => ({ children: CHILDREN }),
			summerState: async (child: string) => ({ child })
		});

		const { data, redirect } = await runLoad('?child=はな');

		expect(redirect).toBeNull();
		expect(data?.child).toBe('はな');
		expect(data?.summer?.child).toBe('はな');
	});
});

// 一覧ページのエクスポートが、黙って終わらないことを固定する。
//
// 設定の書き出しは api を1往復してから <a> を押す作りなので、押した操作の続きとして
// 扱われないことがある（Safari は合成のクリックを黙って捨てる）。落とされても例外は
// 出ないので、いままでは画面に手がかりが1つも残らなかった＝親は書き出せたと思い込む。
// ここで押さえるのは「書き出したことを画面が言い、親が自分で押し直せる」ところまで
// （ファイルが端末に残ったかはブラウザが教えてくれないので、そこは検査できない）。
//
// 本物の <a download> クリックは走らせない（happy-dom が遷移を起こして後続に漏れる）。
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { setApi } from '../../test-support/apiMock';
import { resetAppMocks, setConfirmAnswer } from '../../test-support/appMocks';

const Page = (await import('./+page.svelte')).default;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const childInfo = (child: string) => ({
	child,
	child_kana: child,
	valid: true,
	grade: '小2',
	year: 2026,
	years: [2026],
	period: { start: '2026-07-20', end: '2026-08-31', first_day_of_school: '2026-09-01' },
	revision: 1,
	updated_at: 0,
	error: null
});

const data = (children = ['はな']) => ({
	session: { pin_required: false, authenticated: true, admin_disabled: false },
	definitions: children.map(childInfo),
	loadError: null
});

/** 転ばせる子ども（空なら全部成功）. */
let failing: Set<string> = new Set();
let spies: { mockRestore: () => void }[] = [];
/** 実際に押された <a download> のファイル名（＝端末に落ちにいったもの）. */
let fired: string[] = [];
/** 作った blob URL と、解放した blob URL（数が合わないと定義の写しが残る）. */
let created: string[] = [];
let revoked: string[] = [];
/** 止めた応答を返させる（子どもごとに1つ）. */
let releaseExport: Record<string, () => void> = {};
let holdExport = false;

beforeEach(() => {
	cleanup();
	resetAppMocks();
	failing = new Set();
	fired = [];
	created = [];
	revoked = [];
	releaseExport = {};
	holdExport = false;
	setApi({
		adminExportDoc: async (child: string) => {
			// 止めておくときは、返す時点をテスト側が決める（往復を重ねるため）
			if (holdExport) await new Promise<void>((resolve) => (releaseExport[child] = resolve));
			if (failing.has(child)) throw new Error('つながりませんでした');
			return { filename: `2026-${child}.json`, doc: { child } };
		},
		adminCreateNextYear: async () => ({ year: 2027 }),
		// docker 版と同じ（supported:false＝バックアップのカードごと出ない）
		backupStatus: async () => ({
			supported: false,
			last_backup_at: null,
			changes_since_backup: 0,
			persisted: null,
			storage_ephemeral: false,
			home_hint_dismissed: true
		})
	});
	const realCreate = document.createElement.bind(document);
	spies = [
		spyOn(document, 'createElement').mockImplementation(((tag: string) => {
			const el = realCreate(tag);
			if (tag === 'a') {
				const a = el as HTMLAnchorElement;
				a.click = () => fired.push(a.download);
			}
			return el;
		}) as never),
		spyOn(URL, 'createObjectURL').mockImplementation(((() => {
			created.push(`blob:test-${created.length + 1}`);
			return created[created.length - 1];
		}) as unknown) as never),
		spyOn(URL, 'revokeObjectURL').mockImplementation(((url: string) => {
			revoked.push(url);
		}) as never)
	];
});

afterEach(() => {
	cleanup();
	spies.forEach((s) => s.mockRestore());
});

async function pressExport() {
	render(Page, { props: { data: data() } });
	await flush();
	await fireEvent.click(screen.getByRole('button', { name: 'エクスポート（JSON）' }));
	await flush();
}

describe('管理画面トップのエクスポート', () => {
	it('書き出したことを画面が言い、押し直せるリンクを出す', async () => {
		await pressExport();

		expect(screen.getByText(/2026-はな\.json を書き出しました。/)).toBeTruthy();
		const link = screen.getByRole('link', { name: 'こちらからほぞん' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('blob:test-1');
		expect(link.getAttribute('download')).toBe('2026-はな.json');
	});

	// 取りに行くところで転んだのに「書き出しました」と出ると、いちばん困る種類の嘘になる。
	it('取得で転んだときは「書き出しました」と言わない', async () => {
		failing.add('はな');
		await pressExport();

		expect(screen.queryByText(/を書き出しました。/), '出せていないのに出したと言っている').toBeNull();
		expect(screen.queryByRole('link', { name: 'こちらからほぞん' })).toBeNull();
	});

	// エクスポートのボタンは押した子どもぶんしか止まらないので、2人ぶんが重なって走る。
	// あとから来たほうで上書きすると、先のぶんは release() を呼べる者が居なくなり、
	// 定義の写しを抱えた blob URL がタブを閉じるまで残る。
	it('2人ぶんが重なっても、解放されない書き出しを残さない', async () => {
		const r = render(Page, { props: { data: data(['はな', 'たろう']) } });
		await flush();
		holdExport = true;
		const buttons = screen.getAllByRole('button', { name: 'エクスポート（JSON）' });
		await fireEvent.click(buttons[0]);
		await fireEvent.click(buttons[1]);
		await flush();

		releaseExport['はな']?.(); // 先に押したほうが、あとから返る
		await flush();
		releaseExport['たろう']?.();
		await flush();

		// 押したぶんは2人とも落ちる。世代で譲るのは「行を出す番」だけで、
		// ここで渡すのをやめると、先に押したぶんがファイルも手がかりも無しに消える。
		expect(fired, '追い越されたぶんが、黙って落ちずに消えている').toEqual([
			'2026-はな.json',
			'2026-たろう.json'
		]);
		// 出ているのは、あとに押した1人ぶんだけ
		expect(screen.getByText(/2026-たろう\.json を書き出しました。/)).toBeTruthy();
		expect(screen.queryByText(/2026-はな\.json を書き出しました。/)).toBeNull();

		r.unmount();
		await flush(); // 行に出さないぶんの解放は次の番に回してある
		expect(created.length - revoked.length, '解放されない blob URL が残っている').toBe(0);
	});

	// 追い越されたぶんの失敗は、あとから押したぶんの結果を汚してはいけない。
	// 新しいほうは自分の始まりで actionError を消しているので、そのあとに来た
	// 古いほうのエラーは誰も消さない＝押し直せるリンクと「よみこめませんでした」が
	// 同時に出る（親には、出せたのか出せなかったのか分からない）。
	it('追い越されたぶんが転んでも、あとから押したぶんの結果を汚さない', async () => {
		render(Page, { props: { data: data(['はな', 'たろう']) } });
		await flush();
		holdExport = true;
		failing.add('はな'); // 先に押したほうだけ転ぶ
		const buttons = screen.getAllByRole('button', { name: 'エクスポート（JSON）' });
		await fireEvent.click(buttons[0]);
		await fireEvent.click(buttons[1]);
		await flush();

		releaseExport['はな']?.(); // 追い越されたほうが、先に転んで返る
		await flush();
		releaseExport['たろう']?.();
		await flush();

		expect(screen.getByText(/2026-たろう\.json を書き出しました。/)).toBeTruthy();
		expect(
			screen.queryByText(/つながりませんでした/),
			'追い越されたぶんの失敗が、成功したリンクと同時に出ている'
		).toBeNull();
	});

	// 世代を上げてよいのは「新しく書き出しを押した」と「画面を離れた」の2つだけ。
	// 名前の変更や削除でも上げると、往復の途中で世代が変わり、戻ってきたエクスポートが
	// 自分の待ち表示を消せなくなる＝その子のボタンが、開き直すまで押せないままになる。
	it('書き出しの途中でほかの操作をしても、ボタンが押せなくならない', async () => {
		render(Page, { props: { data: data(['はな']) } });
		await flush();
		holdExport = true;
		const exportButton = screen.getByRole('button', {
			name: 'エクスポート（JSON）'
		}) as HTMLButtonElement;
		await fireEvent.click(exportButton);
		await flush();

		// 待っているあいだに、別の操作が「書き出しました」の行を片づける
		setConfirmAnswer(true);
		await fireEvent.click(screen.getByRole('button', { name: '来年（2027年）ぶんをつくる' }));
		await flush();

		releaseExport['はな']?.();
		await flush();

		expect(exportButton.disabled, 'エクスポートのボタンが押せないままになっている').toBe(false);
		expect(screen.getByText(/2026-はな\.json を書き出しました。/)).toBeTruthy();
	});
});

// 編集画面が「いま編集している年」を離さないことを、実際に描画して固定する。
//
// 年をまたいで定義を持てるようになったあと、この2つを実際に踏んだ:
//   - タブのリンクが `?section=...` だけを書いていた。相対 href はクエリを丸ごと
//     置き換えるので year が落ち、2027年ぶんを直していたのにタブを押した瞬間
//     サーバ既定の年（2026）の画面に化ける。URL の見た目では気づけない
//   - 離脱ガードが「同じパスなら素通し」だった。年タブは同じパスなので、
//     未保存のまま年を切り替えると警告なしにドラフトが作り直されて編集が消える
import { beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { setApi } from '../../../test-support/apiMock';
import {
	confirmMessages,
	resetAppMocks,
	runBeforeNavigate,
	setConfirmAnswer,
	setPageUrl
} from '../../../test-support/appMocks';

// $app/* と $lib/api の差し替えが済んでから読む
const Page = (await import('./+page.svelte')).default;

const doc = () => ({
	child: 'はな',
	child_kana: 'はな',
	year: 2027,
	grade: '小3',
	period: { start: '2027-07-18', end: '2027-08-31', first_day_of_school: '2027-09-01' },
	away: [],
	habits: [],
	daily_homework: [],
	practice_homework: [],
	special_challenges: [],
	rewards: [],
	one_shot_homework: [],
	choice_homework: [],
	school_start_items: []
});

const data = (years = [2026, 2027]) => ({
	session: { pin_required: false, authenticated: true, admin_disabled: false },
	entry: { child: 'はな', year: 2027, years, revision: 1, updated_at: 0, doc: doc() },
	loadError: null,
	child: 'はな'
});

const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

beforeEach(() => {
	// screen は document 全体を見る＝前に描いたものが残っていると「複数見つかった」で落ちる。
	// bun では @testing-library の自動 cleanup が効かないので、描く前に自分で畳む。
	cleanup();
	resetAppMocks();
	setApi({
		adminUsage: () => Promise.resolve({ usage: {} }),
		// 習慣を足すとラベル欄（RubyTextInput）が配当漢字のライブ lint を取りに行く
		adminKanji: () => Promise.resolve({ grades: { '1': '一二三', '2': '', '3': '' } })
	});
	// せいかつタブを開いた状態（きほんタブは VOICEVOX の一覧取得まで走るので避ける）
	setPageUrl('/admin/はな?section=habits&year=2027');
});

describe('編集画面の年', () => {
	it('タブのリンクが編集中の年を連れて行く', () => {
		render(Page, { props: { data: data() } });
		expect(href('まいにち')).toBe('?section=daily&year=2027');
		expect(href('ごほうび')).toBe('?section=rewards&year=2027');
	});

	it('年タブは行き先の年といまのタブを持つ', () => {
		render(Page, { props: { data: data() } });
		expect(href('2026年')).toBe('/admin/%E3%81%AF%E3%81%AA?year=2026&section=habits');
		expect(href('2027年')).toBe('/admin/%E3%81%AF%E3%81%AA?year=2027&section=habits');
	});

	it('年が1つしか無ければ年タブは出さない', () => {
		render(Page, { props: { data: data([2027]) } });
		expect(screen.queryByRole('link', { name: '2027年' })).toBeNull();
		expect(screen.queryByText('この年をけす')).toBeNull();
	});
});

describe('未保存のまま離れるとき', () => {
	/** 「習慣をふやす」で dirty にする（各セクションが markDirty を呼ぶ経路そのもの）. */
	async function makeDirty() {
		await fireEvent.click(screen.getByRole('button', { name: '習慣をふやす' }));
		expect(screen.getByText('保存していない変更があります')).toBeTruthy();
	}

	it('同じ年のタブ切替は聞かずに通す', async () => {
		render(Page, { props: { data: data() } });
		await makeDirty();
		const cancelled = runBeforeNavigate(
			'/admin/はな?section=habits&year=2027',
			'/admin/はな?section=daily&year=2027'
		);
		expect(confirmMessages).toEqual([]);
		expect(cancelled).toBe(false);
	});

	it('年の切替は同じパスでも確認する（黙って編集が消えない）', async () => {
		render(Page, { props: { data: data() } });
		await makeDirty();
		setConfirmAnswer(false);
		const cancelled = runBeforeNavigate(
			'/admin/はな?section=habits&year=2027',
			'/admin/はな?year=2026&section=habits'
		);
		expect(confirmMessages.length).toBe(1);
		expect(cancelled).toBe(true); // 「いいえ」なら年は変わらない
	});

	it('年を書いていない行き先（戻るボタン）でも確認する', async () => {
		// 年なしの URL はサーバ既定の年に着く＝2027 を直していたのに 2026 が開きうる。
		// 年タブを踏んでから戻ると起きるので、ここを素通しにしてはいけない。
		render(Page, { props: { data: data() } });
		await makeDirty();
		setConfirmAnswer(false);
		const cancelled = runBeforeNavigate(
			'/admin/はな?section=habits&year=2027',
			'/admin/はな',
			'popstate'
		);
		expect(confirmMessages.length).toBe(1);
		expect(cancelled).toBe(true);
	});

	it('確認に「はい」と答えれば年は切り替わる', async () => {
		render(Page, { props: { data: data() } });
		await makeDirty();
		setConfirmAnswer(true);
		const cancelled = runBeforeNavigate(
			'/admin/はな?section=habits&year=2027',
			'/admin/はな?year=2026&section=habits'
		);
		expect(cancelled).toBe(false);
	});

	it('変更していなければ年の切替も聞かない', () => {
		render(Page, { props: { data: data() } });
		const cancelled = runBeforeNavigate(
			'/admin/はな?section=habits&year=2027',
			'/admin/はな?year=2026&section=habits'
		);
		expect(confirmMessages).toEqual([]);
		expect(cancelled).toBe(false);
	});
});

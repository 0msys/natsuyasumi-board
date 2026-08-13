// 初回ウィザードが、打った入力を黙って捨てないことを固定する。
//
// ウィザードの入力は $state に持つだけなので、画面を離れた時点で消える。離脱ガードが
// 無かったころは、名前と学年を入れてヘッダーの「一覧へ」を押すと確認も出ずに /admin へ移り、
// 戻ってくると全欄が空・ステップ1に巻き戻っていた（issue #35）。定義がゼロの初回は
// 入口がこの画面へ直行する＝はじめて触る親が最初に見る画面で起きる壊れ方だった。
//
// 逆に、まだ何も打っていないウィザードから出ていくのに確認を出すのは邪魔なだけなので、
// 「入力済みのときだけ聞く」の両側をここで見る。
import { beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { setApi } from '../../../test-support/apiMock';
import {
	confirmMessages,
	gotoCalls,
	resetAppMocks,
	runBeforeNavigate,
	setConfirmAnswer
} from '../../../test-support/appMocks';

// $app/* と $lib/api の差し替えが済んでから読む
const Page = (await import('./+page.svelte')).default;

const data = () => ({
	session: { pin_required: false, authenticated: true, admin_disabled: false }
});

/** ヘッダーの「一覧へ」を押したときの遷移（この画面からのいちばん普通の離脱）. */
const leaveToList = (type = 'link') => runBeforeNavigate('/admin/new', '/admin', type);

const type = (label: string, value: string) =>
	fireEvent.input(screen.getByLabelText(label), { target: { value } });

const next = () => fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));

beforeEach(() => {
	// screen は document 全体を見る＝前に描いたものが残っていると「複数見つかった」で落ちる。
	// bun では @testing-library の自動 cleanup が効かないので、描く前に自分で畳む。
	cleanup();
	resetAppMocks();
	// この画面は作成のときしか api を呼ばない（load でのセッション取得は props で渡す）
	setApi({});
});

describe('入力の途中で離れるとき', () => {
	it('名前を入れたあとは確認し、「いいえ」なら遷移しない', async () => {
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		setConfirmAnswer(false);

		expect(leaveToList()).toBe(true);
		expect(confirmMessages).toEqual([
			'保存していない変更があります。ページを離れると変更は失われます。よろしいですか？'
		]);
	});

	it('確認に「はい」と答えれば離れられる', async () => {
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		setConfirmAnswer(true);

		expect(leaveToList()).toBe(false);
		expect(confirmMessages.length).toBe(1);
	});

	it('ブラウザの戻るでも確認する', async () => {
		// 「一覧へ」を押したときだけ守っても、戻るボタンで同じだけ消える。
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		setConfirmAnswer(false);

		expect(leaveToList('popstate')).toBe(true);
		expect(confirmMessages.length).toBe(1);
	});

	it('よみがなだけでも確認する', async () => {
		render(Page, { props: { data: data() } });
		await type('よみがな（任意）', 'はな');
		setConfirmAnswer(false);

		expect(leaveToList()).toBe(true);
	});

	it('学年だけでも確認する', async () => {
		// ステップ2まで進むには名前が要るので、名前を入れてから消して学年だけを残す
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		await next();
		await fireEvent.click(screen.getByRole('button', { name: '小3' }));
		await fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
		await type('名前', '');
		setConfirmAnswer(false);

		expect(leaveToList()).toBe(true);
	});

	// 日づけだけが残った状態はウィザードでは作れない（ステップ3へ進むのに名前と学年が要る）。
	// 代わりに、いちばん奥まで進んでステップ1へ戻った形を見る——手が止まって一覧を見に行く
	// のはこの辺りで、ここで確認が出ないのが issue #35 の困りごとそのもの。
	it('日づけまで入れてステップ1へ戻ったあとでも確認する', async () => {
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		await next();
		await fireEvent.click(screen.getByRole('button', { name: '小3' }));
		await next();
		await type('なつやすみの初日', '2026-07-20');
		await fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
		await fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
		setConfirmAnswer(false);

		expect(leaveToList()).toBe(true);
	});

	// ブラウザを閉じる・リロードは confirm() を出せない（出しても押される前に閉じる）。
	// SvelteKit は cancel() を合図にブラウザ自身の確認へ渡すので、ここでは黙って cancel する。
	it('ブラウザを閉じるときは、確認を自分で出さずにブラウザへ渡す', async () => {
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');

		expect(leaveToList('leave')).toBe(true);
		expect(confirmMessages).toEqual([]);
	});
});

describe('聞かないとき', () => {
	it('何も入力していなければ黙って通す', () => {
		render(Page, { props: { data: data() } });

		expect(leaveToList()).toBe(false);
		expect(confirmMessages).toEqual([]);
	});

	it('入力を消して空に戻したら、また聞かなくなる', async () => {
		render(Page, { props: { data: data() } });
		await type('名前', 'はな');
		await type('名前', '');

		expect(leaveToList()).toBe(false);
		expect(confirmMessages).toEqual([]);
	});

	// 作成が成功すると自分で編集画面へ飛ぶ。入力欄は埋まったままなので、ここを素通しに
	// しないと「作れました」の直後に「保存していない変更があります」が出る。
	//
	// モックの goto() はガードを呼ばない（本物の goto は呼ぶ）ので、飛んだ先への遷移は
	// 他のテストと同じく runBeforeNavigate() で自分で流す。ここを省くと、素通しの判定を
	// 何も見ないまま通ってしまう。
	it('作成に成功した遷移では確認しない', async () => {
		let sent: unknown = null;
		setApi({
			adminCreateDefinition: async (body: unknown) => {
				sent = body;
				return {};
			}
		});
		render(Page, { props: { data: data() } });

		await type('名前', 'はな');
		await next();
		await fireEvent.click(screen.getByRole('button', { name: '小3' }));
		await next();
		await type('なつやすみの初日', '2026-07-20');
		await type('なつやすみの最終日', '2026-08-31');
		await type('始業式の日', '2026-09-01');
		await next();
		await fireEvent.click(screen.getByRole('button', { name: 'この内容でつくる' }));

		expect(sent).toMatchObject({ child: 'はな', grade: '小3', year: 2026 });
		expect(gotoCalls).toEqual(['/admin/%E3%81%AF%E3%81%AA']);

		setConfirmAnswer(false); // 聞かれたら「いいえ」＝出来たての編集画面へ行けなくなる
		expect(runBeforeNavigate('/admin/new', '/admin/%E3%81%AF%E3%81%AA')).toBe(false);
		expect(confirmMessages).toEqual([]);
	});
});

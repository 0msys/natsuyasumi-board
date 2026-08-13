// 過去日モーダルのスペシャルチャレンジ枠を、実際に描画して固定する。
//
// いちばん踏みやすいのは「きょうの◯が過去日に見える」ほう。サーバが返す
// special_challenges[].status は today の値（service.build_state が today_statuses から埋める）で、
// このモーダルは同じ配列をラベルと key のためだけに受け取る。status を day.statuses から
// 取り直していないと、7/31 を開いても「きょう おてつだいをやった」印が付いて見え、
// そのまま押すと 7/31 の記録が消える（トグルなので done → null になる）。
//
// ロックまわりも props の眺めでは分からない。近い意味の boolean が3つある:
// unlocked（その日の宿題を全部やった＝押せる）・disabled（閲覧専用のあいだ）・
// bonusPending（押せるが base<100 で加点は保留）。片方で代用すると
// 「宿題を全部やったら あけられるよ」という嘘の理由が閲覧中に出る。描いて確かめる。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render } from '@testing-library/svelte';
import type { SummerHistoryDay, SummerSpecialChallenge, SummerUiText } from '$lib/api';

// 共有 Modal は ResizeObserver で高さに追従し、◯の演出は matchMedia を見る。
// happy-dom に無ければ最小のものを置く（挙動の検査には要らない部品）。
if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
}
if (!window.matchMedia) {
	window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {}
	})) as unknown as typeof window.matchMedia;
}

const SummerDayEditModal = (await import('./SummerDayEditModal.svelte')).default;

// 固定文言はキー名をそのまま返す（表示の中身はこのテストの関心ではない）
const ui = new Proxy({}, { get: (_t, k) => String(k) }) as SummerUiText;

const DAY = '2026-07-31';

/** サーバが返す形のチャレンジ定義。status は「きょう」の値が入っている（＝過去日では使えない）. */
const challenges: SummerSpecialChallenge[] = [
	{ key: 'otetsudai', label: 'おてつだい', status: 'done', done_days: 3 }
];

function dayOf(over: Partial<SummerHistoryDay> = {}): SummerHistoryDay {
	return {
		day: DAY,
		weekday: '金',
		statuses: {},
		meta: {},
		away: null,
		edges_window: false,
		is_future: false,
		is_today: false,
		score: null,
		total: null,
		unlocked: false,
		bonus_pending: 0,
		...over
	};
}

/** onSet に渡された引数（呼ばれた順）. */
const calls: unknown[][] = [];

function mount(day: SummerHistoryDay, items: SummerSpecialChallenge[] = challenges) {
	return render(SummerDayEditModal, {
		props: {
			ui,
			day,
			habits: [],
			daily: [],
			challenges: items,
			scoreMax: 100 + 25 * items.length,
			onSet: (...args: unknown[]) => calls.push(args),
			onSetMeta: () => {},
			onClose: () => {}
		}
	});
}

// 共有 Modal はパネルを body 直下へ移す（祖先の transform に position:fixed の基準を
// 奪われないため）。render の container には残らないので、探すのは document から。
const challengeButton = () =>
	document.querySelector<HTMLButtonElement>('button[aria-label="おてつだい"]')!;
const fixButton = () =>
	[...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('day_edit_button')
	)!;
const shown = () => document.body.textContent ?? '';

beforeEach(() => {
	calls.length = 0;
});
afterEach(cleanup); // body へ出したパネルを片づける（次のテストが前の描画を拾わないように）

describe('過去日モーダルのスペシャルチャレンジ', () => {
	it('きょうの◯を持ち込まない（その日の記録で描く）', () => {
		// challenges 側は status:'done'（＝きょうはやった）だが、7/31 には記録がない
		mount(dayOf({ score: 100, total: 100, unlocked: true, is_today: true }));
		expect(challengeButton().getAttribute('aria-pressed')).toBe('false');
	});

	it('その日の宿題が終わっていれば押せて、その日の日付で親へ渡す', () => {
		mount(dayOf({ score: 100, total: 100, unlocked: true, is_today: true }));
		const button = challengeButton();
		expect(button.disabled).toBe(false);
		button.click();
		expect(calls).toEqual([[DAY, 'otetsudai', 'done']]);
	});

	it('記録済みをもう一度押すと未記入へ戻す（✕は出さない）', () => {
		mount(
			dayOf({ score: 100, total: 125, unlocked: true, statuses: { otetsudai: 'done' }, is_today: true })
		);
		const button = challengeButton();
		expect(button.getAttribute('aria-pressed')).toBe('true');
		button.click();
		expect(calls).toEqual([[DAY, 'otetsudai', null]]);
	});

	it('宿題が終わっていれば、基本点が100点未満でも開く（せいかつ待ちの朝）', () => {
		// せいかつが未記入で base=50 でも枠は開く＝夜まで押せない、をやめたのがこの変更
		mount(dayOf({ score: 50, total: 50, unlocked: true, is_today: true }));
		expect(challengeButton().disabled).toBe(false);
		expect(shown()).not.toContain('challenge_locked_overlay');
	});

	it('◯にしていないうちは加点予告を出さない（もらえない点を約束しない）', () => {
		// 保留額は記録したチャレンジの件数から出る。0件なら約束できる点が無い
		mount(dayOf({ score: 50, total: 50, unlocked: true, bonus_pending: 0, is_today: true }));
		expect(shown()).not.toContain('challenge_bonus_pending');
	});

	it('◯にしてあって基本点が100点未満なら、保留中の加点を予告する', () => {
		mount(
			dayOf({
				score: 50,
				total: 50,
				unlocked: true,
				bonus_pending: 25,
				statuses: { otetsudai: 'done' },
				is_today: true
			})
		);
		expect(shown()).toContain('challenge_bonus_pending');
	});

	it('基本点が100点の日には加点予告を出さない（もう入っている）', () => {
		mount(dayOf({ score: 100, total: 125, unlocked: true, bonus_pending: 0, is_today: true }));
		expect(shown()).not.toContain('challenge_bonus_pending');
	});

	it('宿題が終わっていない日はロックする（点数からは組み直さない）', () => {
		// score 99＝あと一歩でも、宿題が残っていれば開かない。逆に score だけ見て開けると、
		// せいかつだけで99点の日に押せてしまう。行の unlocked を読んでいることの確認。
		mount(dayOf({ score: 99, total: 99, unlocked: false, is_today: true }));
		expect(challengeButton().disabled).toBe(true);
		expect(shown()).toContain('challenge_locked_overlay');
	});

	it('記録がない日（score=null）もロックする', () => {
		mount(dayOf({ is_today: true }));
		expect(challengeButton().disabled).toBe(true);
		expect(shown()).toContain('challenge_locked_overlay');
	});

	it('閲覧専用のあいだは押せないが、鍵の理由は出さない（「なおす」で押せるようになる）', async () => {
		const r = mount(dayOf({ score: 100, total: 100, unlocked: true })); // 過去日＝閲覧専用で開く
		expect(challengeButton().disabled).toBe(true);
		// 宿題が終わっている日なので「宿題を全部やったら あけられるよ」は嘘になる＝出してはいけない
		expect(shown()).not.toContain('challenge_locked_overlay');

		fixButton().click();
		await r.rerender({});
		expect(challengeButton().disabled).toBe(false);
	});

	it('チャレンジが0件の定義では枠ごと出さない', () => {
		mount(dayOf({ score: 100, total: 100, unlocked: true, is_today: true }), []);
		expect(shown()).not.toContain('challenge_title');
	});
});

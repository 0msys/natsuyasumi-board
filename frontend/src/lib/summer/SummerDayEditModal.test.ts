// 過去日モーダルのスペシャルチャレンジ枠を、実際に描画して固定する。
//
// いちばん踏みやすいのは「きょうの◯が過去日に見える」ほう。サーバが返す
// special_challenges[].status は today の値（service.build_state が today_statuses から埋める）で、
// このモーダルは同じ配列をラベルと key のためだけに受け取る。status を day.statuses から
// 取り直していないと、7/31 を開いても「きょう おてつだいをやった」印が付いて見え、
// そのまま押すと 7/31 の記録が消える（トグルなので done → null になる）。
//
// ロックまわりも props の眺めでは分からない: unlocked（その日が100点か）と disabled
// （閲覧専用のあいだ）は別物で、片方で代用すると「宿題を100点にしたら あけられるよ」という
// 嘘の理由が閲覧中に出る。描いて確かめる。
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
		mount(dayOf({ score: 100, total: 100, is_today: true }));
		expect(challengeButton().getAttribute('aria-pressed')).toBe('false');
	});

	it('その日が100点なら押せて、その日の日付で親へ渡す', () => {
		mount(dayOf({ score: 100, total: 100, is_today: true }));
		const button = challengeButton();
		expect(button.disabled).toBe(false);
		button.click();
		expect(calls).toEqual([[DAY, 'otetsudai', 'done']]);
	});

	it('記録済みをもう一度押すと未記入へ戻す（✕は出さない）', () => {
		mount(dayOf({ score: 100, total: 125, statuses: { otetsudai: 'done' }, is_today: true }));
		const button = challengeButton();
		expect(button.getAttribute('aria-pressed')).toBe('true');
		button.click();
		expect(calls).toEqual([[DAY, 'otetsudai', null]]);
	});

	it('その日が100点未満ならロックする', () => {
		mount(dayOf({ score: 99, total: 99, is_today: true }));
		expect(challengeButton().disabled).toBe(true);
		expect(shown()).toContain('challenge_locked_overlay');
	});

	it('記録がない日（score=null）もロックする', () => {
		mount(dayOf({ is_today: true }));
		expect(challengeButton().disabled).toBe(true);
		expect(shown()).toContain('challenge_locked_overlay');
	});

	it('閲覧専用のあいだは押せないが、鍵の理由は出さない（「なおす」で押せるようになる）', async () => {
		const r = mount(dayOf({ score: 100, total: 100 })); // 過去日＝閲覧専用で開く
		expect(challengeButton().disabled).toBe(true);
		// 100点の日なので「宿題を100点にしたら あけられるよ」は嘘になる＝出してはいけない
		expect(shown()).not.toContain('challenge_locked_overlay');

		fixButton().click();
		await r.rerender({});
		expect(challengeButton().disabled).toBe(false);
	});

	it('チャレンジが0件の定義では枠ごと出さない', () => {
		mount(dayOf({ score: 100, total: 100, is_today: true }), []);
		expect(shown()).not.toContain('challenge_title');
	});
});

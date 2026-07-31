// 子どもページの「切替をまたいだ後始末」を、実際に描画して固定する。
//
// 対象は、読むだけでは確かめにくく実際に何度も取りこぼした4つ:
//   - 切替の直前に飛んだ書き込みの失敗が、あとから届いて新しい子の画面にエラーを湧かせない
//   - 満点花火と重なったランク到達演出（5.2秒の遅延実行）が、切替で解除される
//   - 開いたままの過去日モーダルが、切替で閉じる
//   - 表示中のエラーが、切替で消える
//
// state のフィクスチャは手書きせず、バックエンドの build_state が実際に返したものを固めて
// ある（__fixtures__/summerState.json）。手で組むと API の形からすぐズレて「テストだけ通る」
// 状態になるため。API の形を変えたら作り直すこと:
//   cd backend && uv run python tools/dump_frontend_fixture.py
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { render } from '@testing-library/svelte';
import type { SummerState } from '$lib/api';
import { stripRuby } from '$lib/summer/ruby';
import { setApi } from '../test-support/apiMock';
import { resetBrowserMocks } from '../test-support/browserMocks';
import fixtures from './__fixtures__/summerState.json';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const hana = () => clone(fixtures.hana) as unknown as SummerState;
const sora = () => clone(fixtures.sora) as unknown as SummerState;
/** 満点＋ランク到達（＝花火とランク演出が重なる条件）の state. */
function hanaRankUp(): SummerState {
	const s = clone(fixtures.hanaPerfect) as unknown as SummerState;
	s.rewards!.achieved_key = 'c'; // 実データでは何日も積まないと立たないので、ここで立てる
	return s;
}

let nextState: SummerState = hana();
let writeFails = false;
let releaseWrite: (() => void) | null = null;

// 読み上げ（$lib/summer/speakText）は差し替えないこと——本物を検査している
// speakText.test.ts を巻き添えで壊す。このページは ttsStatus を available:false に
// しておけば本物のまま無音で素通りする。ランク演出の観測はお祝いバナーの文言で行う。
// api と効果音の差し替えは test-support に集約してある。
const Page = (await import('./+page.svelte')).default;

const CHILDREN = [
	{ child: 'はな', year: 2026, grade: '小2', valid: true },
	{ child: 'そら', year: 2026, grade: '小2', valid: true }
];

function mountPage(summer: SummerState) {
	return render(Page, { props: { data: { children: CHILDREN, child: summer.child, summer } as never } });
}

/** マイクロタスクだけを流す（フェイクタイマー下でも進む）. */
async function drain(times = 20) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

/** 時間を刻んで進める。演出は「発火したハンドラが次のタイマーを仕掛ける」入れ子なので、
 *  一度に大きく進めると内側が取り残される。あいだで await も挟んで非同期の続きを流す.
 *
 *  戻りは「その間に seen が一度でも成り立ったか」。お祝いバナーは 4.2秒で自分から消えるので、
 *  進めきったあとの1点だけを見ると「出たのに見逃す」（実際それで誤検知した）. */
async function advance(ms: number, seen?: () => boolean, step = 500): Promise<boolean> {
	let hit = seen?.() ?? false;
	for (let elapsed = 0; elapsed < ms; elapsed += step) {
		jest.advanceTimersByTime(step);
		await drain(5);
		if (seen?.()) hit = true;
	}
	return hit;
}

// 選択子はフィクスチャの ui から導く（日本語を直書きすると文言変更で黙って壊れる）
const UI = fixtures.hana.ui as Record<string, string>;
const doneButton = (r: { container: HTMLElement }) =>
	r.container.querySelector<HTMLButtonElement>(`button[aria-label="${stripRuby(UI.check_done)}"]`)!;
const dayButton = (r: { container: HTMLElement }, day: string) =>
	r.container.querySelector<HTMLButtonElement>(`button[title="${day}"]`)!;
// 過去日モーダルは body 直下のポータルに出るので container ではなく document から探す
const dayEditModal = () =>
	document.querySelector(`[aria-label="${stripRuby(UI.day_edit_aria)}"]`);

beforeEach(() => {
	resetBrowserMocks();
	nextState = hana();
	writeFails = false;
	releaseWrite = null;
	setApi({
		summerState: async () => clone(nextState),
		summerSetCheck: async () => {
			await new Promise<void>((resolve) => {
				releaseWrite = resolve;
			});
			if (writeFails) throw new Error('/api/summer/check/set → 500 {"detail": "かきこめなかった"}');
			return { status: 'done' };
		},
		summerMediaTimerState: async () => ({
			child: 'はな', day: '2026-08-01', running: false, resumed_at: null,
			accumulated_seconds: 0, elapsed_seconds: 0, server_now: 1_785_000_000,
			limit_seconds: 7200, limit_label: '2時間《じかん》', over_limit: false
		}),
		ttsStatus: async () => ({ available: false, speaker: 3 })
	});
});

afterEach(() => {
	jest.useRealTimers();
});

describe('子どもページ・切替の後始末', () => {
	it('切替をまたいで届いた書き込み失敗は、新しい子の画面に出さない', async () => {
		const r = mountPage(hana());
		writeFails = true;
		// 「やった◯」を1つ押す（どの項目でもよい＝write() を通ることが関心事）
		doneButton(r).click();
		await drain();

		await r.rerender({ data: { children: CHILDREN, child: 'そら', summer: sora() } as never });
		releaseWrite!(); // 切り替えたあとに、前の子あての失敗が届く
		await drain();

		expect(r.container.textContent).not.toContain('かきこめなかった');
	});

	it('同じ子のままなら書き込み失敗はちゃんと出す（黙らせすぎていない）', async () => {
		const r = mountPage(hana());
		writeFails = true;
		doneButton(r).click();
		await drain();
		releaseWrite!();
		await drain();

		expect(r.container.textContent).toContain('かきこめなかった');
	});

	it('表示中のエラーは切替で消える', async () => {
		const r = mountPage(hana());
		writeFails = true;
		doneButton(r).click();
		await drain();
		releaseWrite!();
		await drain();
		expect(r.container.textContent).toContain('かきこめなかった');

		await r.rerender({ data: { children: CHILDREN, child: 'そら', summer: sora() } as never });
		expect(r.container.textContent).not.toContain('かきこめなかった');
	});

	it('開いたままの過去日モーダルは切替で閉じる', async () => {
		const r = mountPage(hana());
		// 履歴グリッドの過去日（おでかけ期間外＝title が日付そのもの）を押す
		dayButton(r, '2026-07-20').click();
		await drain();
		expect(dayEditModal()).toBeTruthy();

		await r.rerender({ data: { children: CHILDREN, child: 'そら', summer: sora() } as never });
		await drain();
		// 残すと refresh() が同じ日付で新しい子の記録へ黙ってつなぎ替える
		expect(dayEditModal()).toBeNull();
	});

	// ランク到達のバナー文言（お祝いは body 直下のポータルに出る）
	const rankBannerShown = () => document.body.textContent?.includes('ランクC たっせい') ?? false;

	/** 満点＋ランク到達の state を1回ポーリングで受け取らせる（花火と重なる＝演出は遅延実行）. */
	async function pollIntoRankUp() {
		nextState = hanaRankUp();
		await advance(60_000, undefined, 10_000);
	}

	it('ランク到達の遅延演出は切替で解除される', async () => {
		jest.useFakeTimers();
		const r = mountPage(hana());
		await drain();
		await pollIntoRankUp();

		await r.rerender({ data: { children: CHILDREN, child: 'そら', summer: sora() } as never });

		// 解除していないと、前の子のランク名のバナーが新しい子の画面に出る
		expect(await advance(20_000, rankBannerShown)).toBe(false);
	});

	it('切り替えなければランク到達の演出はちゃんと出る（解除しすぎていない）', async () => {
		jest.useFakeTimers();
		mountPage(hana());
		await drain();
		await pollIntoRankUp();
		expect(rankBannerShown()).toBe(false); // まだ遅延中（満点花火が先）

		expect(await advance(20_000, rankBannerShown)).toBe(true);
	});
});

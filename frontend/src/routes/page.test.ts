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
// ApiError は $lib/api/contract から取る（$lib/api はモックが丸ごと差し替えるので、
// そちら経由だと undefined になる）。api の実装は両方ともこれを投げる。
import { ApiError } from '$lib/api/contract';
import { stripRuby } from '$lib/summer/ruby';
import { setApi } from '../test-support/apiMock';
import '../test-support/appMocks'; // ページが $app/paths（resolve）を使うので差し替えが要る
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
/** summerSetMeta に渡された引数（呼ばれた順）. */
const metaCalls: { child: string; day: string; itemKey: string; updates: Record<string, unknown> }[] = [];
/** 書き込みが失敗したときに api が投げるもの（既定は docker 版＝JSON 本文つき）. */
let writeError: unknown = null;

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
	metaCalls.length = 0;
	// 書き込みが弾かれたときの形（docker 版＝JSON 本文つきの 400）。
	// 子どもあての文言を持つのは 400 だけなので、status も実物に合わせる。
	writeError = new ApiError(400, '{"detail": "かきこめなかった"}', '/api/summer/check/set');
	setApi({
		summerState: async () => clone(nextState),
		summerSetCheck: async () => {
			await new Promise<void>((resolve) => {
				releaseWrite = resolve;
			});
			if (writeFails) throw writeError;
			return { status: 'done' };
		},
		summerSetMeta: async (
			child: string,
			day: string,
			itemKey: string,
			updates: Record<string, unknown>
		) => {
			metaCalls.push({ child, day, itemKey, updates });
			return updates;
		},
		summerMediaTimerState: async () => ({
			child: 'はな', day: '2026-08-01', running: false, resumed_at: null,
			accumulated_seconds: 0, elapsed_seconds: 0, server_now: 1_785_000_000,
			limit_seconds: 7200, limit_label: '2時間《じかん》', over_limit: false
		}),
		ttsStatus: async () => ({ available: false, speaker: 3 }),
		// ブラウザ保存の版だけが使う。ここでは出番なし＝歯車に印は付かない。
		backupStatus: async () => ({
			supported: false,
			last_backup_at: null,
			changes_since_backup: 0,
			persisted: null,
			storage_ephemeral: false,
			home_hint_dismissed: true
		})
	});
});

afterEach(() => {
	jest.useRealTimers();
	Date.now = realNow;
});

const realNow = Date.now;
/** ストップウォッチは実時間で計るので、経過を作るには時計そのものを持つしかない
 *  （1秒未満のストップは押し間違いとして捨てられる＝クリックだけでは何も起きない）. */
function stubClock(): (ms: number) => void {
	let now = 1_800_000_000_000;
	Date.now = () => now;
	return (ms: number) => {
		now += ms;
	};
}

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

// 出す・出さないの判断は上の describe、ここは「何と書いてあるか」。
// ひらがなの画面なので、数字も英語も混ぜない（文言の組み立ては $lib/api/apiError）。
describe('子どもページ・失敗の文言', () => {
	/** 書き込みを1回失敗させて、画面に出た文言を返す. */
	async function failedWriteText(thrown: unknown): Promise<string> {
		writeError = thrown;
		writeFails = true;
		const r = mountPage(hana());
		doneButton(r).click();
		await drain();
		releaseWrite!();
		await drain();
		return r.container.textContent ?? '';
	}

	it('lite の書き込みエラーに status を混ぜない', async () => {
		// lite は where 無しで投げるので、message は「400 まだ さきのひは かけないよ」になる。
		// message を出していたころは、この 400 がそのまま子どもの画面に出ていた。
		const text = await failedWriteText(new ApiError(400, 'まだ さきのひは かけないよ'));
		expect(text).toContain('まだ さきのひは かけないよ');
		expect(text).not.toContain('400');
	});

	it('api の文言でない失敗は、決まった一言に畳む', async () => {
		// 読み上げ再生の DOMException や通信断がこれ。英語のまま出すわけにいかない。
		const text = await failedWriteText(new Error('Failed to fetch'));
		expect(text).not.toContain('Failed to fetch');
		expect(text).toContain('もういちど');
	});

	it('本文が空の失敗でも、何か出す（黙って消えない）', async () => {
		const text = await failedWriteText(new ApiError(502, '', '/api/summer/check/set'));
		expect(text).toContain('もういちど');
	});

	it('定義が壊れている 503 は、日本語でも子どもの画面に出さない', async () => {
		// lite の shared.ts / docker の summer.py が投げる形。親あての文言。
		const text = await failedWriteText(new ApiError(503, '「はな」の定義がありません'));
		expect(text).not.toContain('定義');
		expect(text).toContain('もういちど');
	});
});

// ストップウォッチのストップは、done 化とタイムの保存の2回に分かれている。
// 2回目の書き先を決め打ちにすると、管理画面から足した時間欄では毎回サーバに弾かれ、
// 「◯は内部で立ったのに画面に出ず、はかったタイムだけ消える」という壊れかたをする
// （write() は失敗すると refresh() へ進まない）。ここは押してから保存までを通しで固定する。
describe('計算カードのストップウォッチ', () => {
	/** 時間欄のキーを差し替えた state.
	 *
	 *  フィクスチャは手書きのサンプル定義から来ていて、時間欄がたまたま `seconds`。
	 *  管理画面の「メモ欄をふやす」で足した欄のキーは採番される（keys.ts の `m_` 接頭辞）ので、
	 *  フィクスチャのままだと「決め打ちで書いても通る」状態を素通りする。 */
	function withDurationKey(key: string): SummerState {
		const s = hana();
		for (const hw of s.daily_homework) {
			const field = hw.meta_fields.find((f) => f.type === 'duration');
			if (field) field.key = key;
		}
		return s;
	}

	const stopwatchButton = (r: { container: HTMLElement }, label: string) =>
		[...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

	it('はかったタイムは、その宿題の時間欄へ保存する', async () => {
		const r = mountPage(withDurationKey('m_ab12cd'));
		await drain();

		const tick = stubClock();
		stopwatchButton(r, UI.stopwatch_start)!.click();
		await drain();
		tick(42_000);
		stopwatchButton(r, UI.stopwatch_stop)!.click();
		await drain();
		releaseWrite!(); // 先行する done 化を通す（メモは「やった」の行にしか書けない）
		await drain();

		expect(metaCalls).toEqual([
			{ child: 'はな', day: '2026-08-01', itemKey: 'keisan', updates: { m_ab12cd: 42 } }
		]);
		expect(r.container.textContent).not.toContain('もういちど'); // 弾かれていない
	});
});

// 子どもを切り替えたときに「前の子のものが残らない」ことを、実際に描画して固定する。
//
// この欄は {#each ... (hw.key)} の中で子コンポーネントを描く。標準テンプレだとどの子も
// 同じ項目キー（ondoku・keisan など）を持つので、{#key} が無いと兄弟のあいだで
// インスタンスが再利用される。再利用されると、マウント時に1回だけ種をまく子（メモ欄）や
// 自前で計測を持ちつづける子（ストップウォッチ）が前の子の状態を引き継ぎ、
// そのまま新しい子の記録として保存されてしまう。
//
// これは props を眺めても分からない「マウント境界」の挙動で、実際に何度も取りこぼした。
// {#key} を外すとここが落ちる（＝この検査は空虚でない）ことを確認済み。
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/svelte';
import { setApi } from '../../test-support/apiMock';
import type { SummerDailyHomework, SummerUiText } from '$lib/api';

const todoCalls: string[] = [];
let todoFails = false;
let releaseTodo: (() => void) | null = null;
const summerTodoSpeech = async (child: string) => {
	todoCalls.push(child);
	// releaseTodo を握らせて、応答が返る時点をテスト側で決められるようにする
	await new Promise<void>((resolve) => {
		releaseTodo = resolve;
	});
	if (todoFails) throw new Error(`/api/summer/todo-speech → 500`);
	return { day: '2026-08-01', text: `${child}のやること`, remaining: [] };
};

const SummerTodayChecks = (await import('./SummerTodayChecks.svelte')).default;

// 固定文言はキー名をそのまま返す（表示の中身はこのテストの関心ではない）
const ui = new Proxy({}, { get: (_t, k) => String(k) }) as SummerUiText;

/** 「本のだいめい」メモを持つ音読（どの子も同じ項目キー＝標準テンプレと同じ状況）. */
function ondoku(book: string): SummerDailyHomework {
	return {
		key: 'ondoku',
		label: 'おんどく',
		status: 'done',
		done_days: 1,
		meta_fields: [{ key: 'book', type: 'text', label: '本', placeholder: null, options: [] }],
		meta: { book }
	};
}

/** ストップウォッチが出る計算カード（duration メモ持ち）.
 *
 *  時間欄のキーは、管理画面の「メモ欄をふやす」で足したときに振られる形にしてある
 *  （keys.ts の `m_` 接頭辞＋採番）。手書きのサンプル定義や金型がたまたま `seconds` を
 *  使っているので、そこから写したキーで固めると「決め打ちで書いても通る」テストになる
 *  ——実際それで、親が自分で足した時間欄では一度も保存できない状態を素通ししていた。 */
function keisan(fieldKey = 'm_ab12cd'): SummerDailyHomework {
	return {
		key: 'keisan',
		label: 'けいさん',
		status: 'not_done',
		done_days: 0,
		// 実物と同じく時間欄は先頭ではない（サンプル定義の計算カードは「しゅるい」が先）。
		// 先頭決め打ちで拾っていないことも、これで一緒に固まる。
		meta_fields: [
			{ key: 'calc_type', type: 'choice', label: 'しゅるい', placeholder: null, options: [] },
			{ key: fieldKey, type: 'duration', label: 'タイム', placeholder: null, options: [] }
		],
		meta: null
	};
}

const errors: unknown[] = [];
/** onStopwatchStop に渡された引数（呼ばれた順）. */
const stopwatchCalls: unknown[][] = [];

function mountFor(child: string, daily: SummerDailyHomework[], ttsAvailable = false) {
	return render(SummerTodayChecks, {
		props: {
			ui,
			child,
			habits: [],
			daily,
			ttsAvailable,
			onSet: () => {},
			onSetMeta: () => {},
			onStopwatchStop: (...args: unknown[]) => stopwatchCalls.push(args),
			onError: (e: unknown) => errors.push(e)
		}
	});
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const askButton = (r: { container: HTMLElement }) =>
	[...r.container.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('todo_speech_ask')
	)!;

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

beforeEach(() => {
	todoCalls.length = 0;
	errors.length = 0;
	stopwatchCalls.length = 0;
	todoFails = false;
	releaseTodo = null;
	setApi({ summerTodoSpeech });
});

afterEach(() => {
	Date.now = realNow;
});

describe('子どもの切替', () => {
	it('メモ欄は新しい子の値で種まきし直される（前の子のメモが残らない）', async () => {
		const r = mountFor('はな', [ondoku('かいけつゾロリ')]);
		const input = () => r.container.querySelector<HTMLInputElement>('input[type="text"]')!;
		expect(input().value).toBe('かいけつゾロリ');

		await r.rerender({ child: 'そら', daily: [ondoku('はらぺこあおむし')] });
		// {#key} が無いとバッファが再利用され「かいけつゾロリ」のまま残り、
		// blur でそらの記録として保存されてしまう
		expect(input().value).toBe('はらぺこあおむし');
	});

	it('入力途中のメモも持ち越さない（blur で別の子へ書き込まない）', async () => {
		const r = mountFor('はな', [ondoku('かいけつゾロリ')]);
		const input = () => r.container.querySelector<HTMLInputElement>('input[type="text"]')!;
		// はなの欄に打ちかけの文字（まだ blur していない＝サーバには無い）
		input().value = 'うちかけ';
		input().dispatchEvent(new Event('input', { bubbles: true }));

		await r.rerender({ child: 'そら', daily: [ondoku('はらぺこあおむし')] });
		expect(input().value).toBe('はらぺこあおむし');
	});

	it('走っているストップウォッチは引き継がれない（タイムが別の子へ入らない）', async () => {
		const r = mountFor('はな', [keisan()]);
		const button = (label: string) =>
			[...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

		button('stopwatch_start')!.click();
		await r.rerender({}); // 走行中（ストップが出ている）
		expect(button('stopwatch_stop')).toBeTruthy();

		await r.rerender({ child: 'そら', daily: [keisan()] });
		// 作り直されて停止状態に戻る＝そらの画面でストップを押しても
		// はなで計ったタイムが保存されることはない
		expect(button('stopwatch_stop')).toBeUndefined();
		expect(button('stopwatch_start')).toBeTruthy();
	});

	it('表示済みの「きょうやること」は前の子のまま残らない', async () => {
		const r = mountFor('はな', [], true);
		askButton(r).click();
		releaseTodo!();
		await flush();
		await r.rerender({});
		expect(todoCalls).toEqual(['はな']);
		expect(r.container.textContent).toContain('はなのやること');

		await r.rerender({ child: 'そら' });
		expect(r.container.textContent).not.toContain('はなのやること');
	});

	it('切替をまたいで届いた失敗は、新しい子の画面にエラーを出さない', async () => {
		// 切替時にエラー表示を消しても、切替前に飛んだ要求の失敗はあとから届く。
		// 素直に報告すると、新しい子の画面に前の子あてのエラーが湧き直す。
		const r = mountFor('はな', [], true);
		todoFails = true;
		askButton(r).click();
		await r.rerender({ child: 'そら' }); // 応答を待つあいだに切り替えた
		releaseTodo!();
		await flush();
		expect(errors).toEqual([]);
	});

	it('同じ子のままなら失敗はちゃんと報告する', async () => {
		const r = mountFor('はな', [], true);
		todoFails = true;
		askButton(r).click();
		releaseTodo!();
		await flush();
		expect(errors).toHaveLength(1);
	});
});

// ストップウォッチを出すかどうかの判定は「時間欄があるか」だが、はかったタイムを
// 書き込む先はその欄そのもの。出す・出さないだけ見て書き先を捨てると、親はキーを
// 決め打ちするしかなくなる＝管理画面から足した時間欄（採番されたキー）では毎回
// サーバに弾かれ、はかったタイムが消える。ここは書き先が親まで届くことを固定する。
describe('ストップウォッチの書き先', () => {
	const stopwatchButton = (r: { container: HTMLElement }, label: string) =>
		[...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

	it('はかったタイムは、その宿題の時間欄のキーで渡す', async () => {
		const r = mountFor('はな', [keisan()]);
		const tick = stubClock();

		stopwatchButton(r, 'stopwatch_start')!.click();
		await r.rerender({});
		tick(42_000);
		stopwatchButton(r, 'stopwatch_stop')!.click();
		await r.rerender({});

		// 'seconds' を決め打ちしていたころは、この欄では保存が
		// 「しらない メモの こうもくだよ」で弾かれ、タイムはどこにも残らなかった
		expect(stopwatchCalls).toEqual([['keisan', 'm_ab12cd', 42]]);
	});

	it('手書き定義そのままの `seconds` 欄でも、同じ道を通る', async () => {
		const r = mountFor('はな', [keisan('seconds')]);
		const tick = stubClock();

		stopwatchButton(r, 'stopwatch_start')!.click();
		await r.rerender({});
		tick(7_000);
		stopwatchButton(r, 'stopwatch_stop')!.click();
		await r.rerender({});

		expect(stopwatchCalls).toEqual([['keisan', 'seconds', 7]]);
	});

	it('時間欄が無い宿題にはストップウォッチを出さない', () => {
		const r = mountFor('はな', [ondoku('かいけつゾロリ')]);
		expect(stopwatchButton(r, 'stopwatch_start')).toBeUndefined();
	});
});

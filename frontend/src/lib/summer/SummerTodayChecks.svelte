<script lang="ts">
	// きょうのチェック（生活習慣＋毎日の宿題＋くりかえしの宿題）。
	// edges 習慣（早寝早起き朝ごはん・アウトメディア）は記録欄がある日だけ表示する。
	// 見出し右の「きょうやることをきく」は /api/summer/todo-speech の決定的テキストを
	// 既存 /api/tts（VOICEVOX）で合成して再生し、同内容を見出し直下にも表示する。
	import { onDestroy } from 'svelte';
	import { Sparkles, BookOpenText, Volume2 } from '@lucide/svelte';
	import { api } from '$lib/api';
	import type { SummerCheckStatus, SummerDailyHomework, SummerHabit, SummerUiText } from '$lib/api';
	import SummerCheckButtons from './SummerCheckButtons.svelte';
	import SummerMetaInputs from './SummerMetaInputs.svelte';
	import SummerStopwatch from './SummerStopwatch.svelte';
	import Ruby from './Ruby.svelte';
	import { speakSummerText, unlockSummerSpeech } from './speakText';

	let {
		ui,
		child,
		habits,
		daily,
		ttsAvailable,
		onSet,
		onSetMeta,
		onStopwatchStop,
		onError
	}: {
		ui: SummerUiText;
		child: string;
		habits: SummerHabit[];
		daily: SummerDailyHomework[];
		ttsAvailable: boolean;
		onSet: (itemKey: string, status: SummerCheckStatus) => void;
		onSetMeta: (itemKey: string, fieldKey: string, value: string | number | null) => void;
		onStopwatchStop: (itemKey: string, seconds: number) => void;
		onError: (e: unknown) => void;
	} = $props();

	const activeHabits = $derived(habits.filter((h) => h.window_active));

	let destroyed = false;
	onDestroy(() => (destroyed = true));

	let speechBusy = $state(false);
	// 取得した「きょうやること」と、それが誰のぶんか。この欄は子どもを切り替えても
	// 作り直されず child prop が差し替わるだけなので、文字列だけ持つと前の子の
	// 「やること」が新しい子の画面に残る。誰のぶんかを一緒に持って表示は導出にする
	// ＝切替時のリセットを書き忘れても古い内容が出ない。
	let todo = $state<{ child: string; text: string } | null>(null);
	const todoText = $derived(todo && todo.child === child ? todo.text : null);

	async function askTodo() {
		unlockSummerSpeech(); // クリック同期部で iOS 解放
		// 合成を待つあいだに子どもが切り替わる（この欄は同じルート内で child prop が
		// 差し替わる）ことがある。返ってきた時点で対象が変わっていたら鳴らさない。
		const requested = child;
		const stillCurrent = () => !destroyed && child === requested;
		speechBusy = true;
		try {
			const res = await api.summerTodoSpeech(requested);
			if (!stillCurrent()) return;
			todo = { child: requested, text: res.text };
			await speakSummerText(res.text, requested, stillCurrent);
		} catch (e) {
			if (stillCurrent()) onError(e); // 切替をまたいだ失敗は新しい子の画面に出さない
		} finally {
			speechBusy = false;
		}
	}
</script>

{#snippet checkRow(key: string, label: string, status: SummerCheckStatus, cancelable: boolean)}
	<div class="flex items-center justify-between gap-2 rounded-lg bg-surface2/60 px-3 py-2 lg:px-4">
		<span class="text-sm text-text-base lg:text-lg"><Ruby text={label} /></span>
		<SummerCheckButtons {ui} {status} {cancelable} onSet={(s) => onSet(key, s)} />
	</div>
{/snippet}

{#snippet metaRow(item: SummerDailyHomework)}
	<div class="rounded-lg bg-surface2/60 px-3 py-2 lg:px-4">
		<div class="flex items-center justify-between gap-2">
			<span class="text-sm text-text-base lg:text-lg"><Ruby text={item.label} /></span>
			<SummerCheckButtons {ui} status={item.status} onSet={(s) => onSet(item.key, s)} />
		</div>
		<!-- ここから下は「マウント時に1回だけ種をまく／自前で計測を持ちつづける」子で、
		     どちらも作り直しは親の責任（各コンポーネントの但し書き参照）。child を key に
		     含めるのが要点: この欄は {#each ... (hw.key)} の中にあり、標準テンプレだと
		     どの子も同じ項目キー（ondoku・keisan など）を持つので、key が無いと兄弟のあいだで
		     インスタンスが再利用される。すると
		       - メモ欄: 前の子のメモが残り、blur で新しい子の記録として保存される
		       - ストップウォッチ: 前の子で走り出した計測がそのまま続き、ストップを押すと
		         そのタイムが新しい子へ保存される（切替をまたいだ計測は帰属先が決められないので、
		         作り直して捨てるのが正しい。破棄時に interval も止まる）
		     item.key は同じ子のあいだ不変なので、60秒ポーリングで入力や計測が飛ぶことはない。 -->
		{#key child + ':' + item.key}
			<!-- 計算カード（duration メモ持ち）は done 前でもストップウォッチを出す。
			     ストップで自動 done 化＋タイムを保存するので流れが自然（親が処理）。 -->
			{#if item.meta_fields.some((f) => f.type === 'duration')}
				<SummerStopwatch {ui} onStop={(seconds) => onStopwatchStop(item.key, seconds)} />
			{/if}
			{#if item.status === 'done' && item.meta_fields.length}
				<SummerMetaInputs
					{ui}
					fields={item.meta_fields}
					value={item.meta}
					onSet={(fieldKey, v) => onSetMeta(item.key, fieldKey, v)}
				/>
			{/if}
		{/key}
	</div>
{/snippet}

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<div class="mb-3 flex items-center justify-between gap-2">
		<h2 class="flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
			<Sparkles size={20} class="text-accent" /><Ruby text={ui.today_checks_title} />
		</h2>
		{#if ttsAvailable}
			<button
				type="button"
				disabled={speechBusy}
				onclick={askTodo}
				class="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50 lg:text-sm"
			>
				<Volume2 size={18} />
				<Ruby text={speechBusy ? ui.todo_speech_busy : ui.todo_speech_ask} />
			</button>
		{/if}
	</div>
	{#if todoText}
		<p
			class="mb-3 rounded-lg bg-surface2/60 px-3 py-2 text-sm leading-relaxed text-text-base lg:text-base"
		>
			<Ruby text={todoText} />
		</p>
	{/if}

	<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-dim lg:text-sm">
		<Ruby text={ui.section_habits} />
	</div>
	<div class="flex flex-col gap-1.5 lg:gap-2">
		{#each activeHabits as habit (habit.key)}
			{@render checkRow(habit.key, habit.label, habit.status, habit.cancelable)}
		{/each}
	</div>

	<div class="mt-4 mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-dim lg:text-sm">
		<BookOpenText size={14} /><Ruby text={ui.section_daily} />
	</div>
	<div class="flex flex-col gap-1.5 lg:gap-2">
		{#each daily as hw (hw.key)}
			{@render metaRow(hw)}
		{/each}
	</div>

</section>

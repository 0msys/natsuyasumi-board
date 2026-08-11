<script lang="ts">
	// 計算カードのタイムアタック用インライン・ストップウォッチ。
	// スタート→れんしゅう→ストップで、はかったタイム（秒）を親へ渡す
	// （親が done 化＋その項目の duration メモ欄へ保存。どの欄に書くかは親が知っている）。
	// 走行中だけこのコンポーネント内で 1 秒ごとに経過を更新する（ページ全体を毎秒再描画させない）。
	// 拡大表示は付けない（カード内に小さく）＝計画どおり。
	import { Play, Square, Timer } from '@lucide/svelte';
	import type { SummerUiText } from '$lib/api';
	import { fmtElapsed } from '$lib/timerFormat';
	import Ruby from './Ruby.svelte';

	let { ui, onStop }: { ui: SummerUiText; onStop: (seconds: number) => void } = $props();

	let running = $state(false);
	let elapsed = $state(0); // 表示用の経過秒（走行中に 1s ごと更新）
	let startMs = 0;
	let handle = 0;

	function start() {
		running = true;
		startMs = Date.now();
		elapsed = 0;
		handle = window.setInterval(() => {
			elapsed = Math.floor((Date.now() - startMs) / 1000);
		}, 1000);
	}

	function stop() {
		running = false;
		if (handle) {
			clearInterval(handle);
			handle = 0;
		}
		const total = Math.round((Date.now() - startMs) / 1000);
		elapsed = 0;
		if (total >= 1) onStop(total); // 押し間違い（0秒）ではメモを書き換えない
	}

	// 親の {#key} 再マウントやページ遷移で走行中でも interval を確実に止める
	$effect(() => () => {
		if (handle) clearInterval(handle);
	});
</script>

<div class="mt-2 flex items-center gap-2 rounded-lg bg-surface2/50 px-3 py-2">
	<Timer size={16} class="shrink-0 text-accent" />
	<span class="w-14 shrink-0 text-xs text-text-dim lg:w-16 lg:text-sm"><Ruby text={ui.stopwatch_label} /></span>
	<span class="min-w-0 flex-1 text-lg font-bold tabular-nums text-text-base lg:text-2xl">
		{fmtElapsed(elapsed)}
	</span>
	{#if running}
		<button
			type="button"
			onclick={stop}
			class="flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white lg:text-sm"
		>
			<Square size={16} /><Ruby text={ui.stopwatch_stop} />
		</button>
	{:else}
		<button
			type="button"
			onclick={start}
			class="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white lg:text-sm"
		>
			<Play size={16} /><Ruby text={ui.stopwatch_start} />
		</button>
	{/if}
</div>

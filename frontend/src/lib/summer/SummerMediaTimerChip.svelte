<script lang="ts">
	// ヘッダの「テレビタイマー」起動チップ。走行中は live 経過を小さく併記する
	// （開かなくても稼働が分かる）。毎秒更新はこのチップ内に閉じ込める（ページ全体を再描画しない）。
	import { Tv } from '@lucide/svelte';
	import type { SummerMediaTimerState, SummerUiText } from '$lib/api';
	import { fmtElapsed } from '$lib/timerFormat';
	import Ruby from './Ruby.svelte';

	let {
		ui,
		timer,
		onOpen
	}: { ui: SummerUiText; timer: SummerMediaTimerState | null; onOpen: () => void } = $props();

	let nowSec = $state(Date.now() / 1000);
	$effect(() => {
		if (!timer?.running) return;
		const h = setInterval(() => (nowSec = Date.now() / 1000), 1000);
		return () => clearInterval(h);
	});

	const display = $derived(
		timer
			? Math.max(0, Math.round(timer.elapsed_seconds + (timer.running ? nowSec - timer.server_now : 0)))
			: 0
	);
	const over = $derived(timer ? display >= timer.limit_seconds : false);
	const active = $derived((timer?.accumulated_seconds ?? 0) > 0 || (timer?.running ?? false));
</script>

<button
	type="button"
	onclick={onOpen}
	class="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold lg:text-sm
		{timer?.running
		? 'border-accent bg-accent/10 text-accent'
		: 'border-border-dim bg-surface2 text-text-dim'}"
>
	<Tv size={16} />
	<Ruby text={ui.timer_title} />
	{#if active}
		<span class="tabular-nums {over ? 'text-rose-500' : ''}">{fmtElapsed(display)}</span>
	{/if}
</button>

<script lang="ts">
	// アウトメディア「テレビタイマー」の最前面ポップアップ（ヘッダのチップから開く）。
	// 大きく経過を出し、テレビをつけたらスタート／消したらストップ（一時停止）／また見たらさいかい。
	// 上限（子どもごと・サーバが limit_seconds / limit_label で配る）を超えたら時間表示を
	// 目立つ色に変えるだけ（音は鳴らさない＝色のコントラストで示す）。
	// リセットボタンは置かない（毎日0はサーバが day キーで自動）。Modal（body portal・a11y）を再利用。
	import Modal from '$lib/Modal.svelte';
	import type { SummerMediaTimerState, SummerUiText } from '$lib/api';
	import { fmtElapsed } from '$lib/timerFormat';
	import { Tv, Play, Square, X } from '@lucide/svelte';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';
	import type { MediaTimerErrorKind } from './mediaTimerStore';

	let {
		ui,
		timer,
		lastError,
		onStart,
		onPause,
		onClose
	}: {
		ui: SummerUiText;
		timer: SummerMediaTimerState | null;
		lastError: MediaTimerErrorKind | null;
		onStart: () => void;
		onPause: () => void;
		onClose: () => void;
	} = $props();

	// 走行中はこのコンポーネント内で1秒ごとにローカル補間（server_now 基準＝端末時計に依存しない）。
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
	const limit = $derived(timer?.limit_seconds ?? 7200);
	const limitLabel = $derived(timer?.limit_label ?? '');
	const over = $derived(display >= limit);
	const remaining = $derived(Math.max(0, limit - display));
	const running = $derived(timer?.running ?? false);
	const started = $derived((timer?.accumulated_seconds ?? 0) > 0 || running); // 一度でも計測したか
</script>

<Modal anchorY={null} {onClose} maxWidthPx={480} gutterRem={2} maxHeightVh={85} ariaLabel={stripRuby(ui.timer_title)}>
	<div class="mb-4 flex items-center justify-between gap-3">
		<h2 class="flex items-center gap-2 text-lg font-semibold text-text-base lg:text-xl">
			<Tv class="h-6 w-6 text-accent" /><Ruby text={ui.timer_title} />
		</h2>
		<button
			type="button"
			class="grid h-9 w-9 place-items-center rounded-md border-0 bg-surface2 text-text-dim hover:bg-surface hover:text-text-base"
			aria-label={stripRuby(ui.close_aria)}
			onclick={onClose}
		>
			<X class="h-5 w-5" />
		</button>
	</div>

	<div class="flex flex-col items-center gap-1 py-4">
		<span class="text-sm text-text-dim"><Ruby text={ui.timer_watched_today} /></span>
		<span
			class="text-6xl font-bold tabular-nums lg:text-7xl {over ? 'text-rose-500' : 'text-text-base'}"
		>
			{fmtElapsed(display)}
		</span>
		<!-- 上限の文言（{limit}）はサーバが子どもごと・学年ごとに開いて配る。
		     初回ポーリング前（timer=null）は上限が分からないので、この行は出さない。 -->
		{#if !timer}
			<span class="mt-1 text-sm text-text-dim lg:text-base">&nbsp;</span>
		{:else if over}
			<span class="mt-1 text-base font-bold text-rose-500 lg:text-lg">
				<Ruby text={fmt(ui.timer_over_limit, { limit: limitLabel })} />
			</span>
		{:else}
			<span class="mt-1 text-sm text-text-dim lg:text-base">
				<Ruby text={fmt(ui.timer_remaining, { limit: limitLabel, left: fmtElapsed(remaining) })} />
			</span>
		{/if}
	</div>

	{#if running}
		<button
			type="button"
			onclick={onPause}
			class="flex w-full items-center justify-center gap-2 rounded-lg border-0 bg-rose-500 py-3 text-base font-semibold text-white"
		>
			<Square class="h-5 w-5" /><Ruby text={ui.timer_stop} />
		</button>
	{:else}
		<button
			type="button"
			onclick={onStart}
			class="flex w-full items-center justify-center gap-2 rounded-lg border-0 bg-accent py-3 text-base font-semibold text-white"
		>
			<Play class="h-5 w-5" /><Ruby text={started ? ui.timer_resume : ui.timer_start} />
		</button>
	{/if}

	{#if lastError}
		<p class="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
			<Ruby
				text={lastError === 'start'
					? ui.timer_error_start
					: lastError === 'pause'
						? ui.timer_error_pause
						: ui.timer_error_load}
			/>
		</p>
	{/if}

	<button
		type="button"
		class="mt-3 w-full rounded-lg border-0 bg-surface2 py-2.5 text-sm font-semibold text-text-dim hover:text-text-base"
		onclick={onClose}
	>
		<Ruby text={ui.close} />
	</button>
</Modal>

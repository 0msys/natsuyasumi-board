<script lang="ts">
	// 3値チェックの共有ボタン対（やった◯／やらなかった✕）。
	// 同じボタンをもう一度押すと未記入（null）へ戻す。子ども本人が押す前提の大きめターゲット。
	// cancelable な項目（ラジオ体操など）だけ「中止」ボタン（雨天等で行事中止＝満点扱い）を足す。
	// ◯にした瞬間だけ星はじけ＋スタンプ押し込み＋「ポンッ」を鳴らす（ここに内蔵するので
	// きょうのチェックと過去日修正モーダルの両方で効く）。演出はサーバ往復を待たず先行し、
	// 記録自体は confirm-before-update のまま（POST 失敗は既存のエラー帯で見える）。
	import { Circle, CloudRain, Star, X } from '@lucide/svelte';
	import type { SummerCheckStatus, SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { playPop, unlockSummerSfx } from './sfx';

	let {
		ui,
		status,
		disabled = false,
		cancelable = false,
		onSet
	}: {
		ui: SummerUiText;
		status: SummerCheckStatus;
		disabled?: boolean;
		cancelable?: boolean;
		onSet: (status: SummerCheckStatus) => void;
	} = $props();

	type Particle = {
		dx: number;
		dy: number;
		rot: number;
		size: number;
		color: string;
		star: boolean;
		delay: number;
	};
	const COLORS = ['text-amber-400', 'text-emerald-400', 'text-sky-400', 'text-rose-400'];
	let particles = $state<Particle[]>([]);
	let burstId = $state(0);
	let clearTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => () => {
		if (clearTimer) clearTimeout(clearTimer);
	});

	// ◯遷移の同期部で呼ぶ: 効果音（iOS 解放込み）＋星はじけ。
	// reduced-motion では粒の生成自体をスキップする（CSS の animation:none だと
	// 原点に静止した粒が残ってしまうため）。音と done の色変化は reduce でも残す。
	function fireBurst() {
		unlockSummerSfx();
		playPop();
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const n = 9;
		particles = Array.from({ length: n }, (_, i) => {
			const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6;
			const dist = 26 + Math.random() * 14;
			return {
				dx: Math.cos(angle) * dist,
				dy: Math.sin(angle) * dist - 6,
				rot: Math.random() * 260 - 130,
				size: 4 + Math.random() * 4,
				color: COLORS[i % COLORS.length],
				star: i % 3 === 0,
				delay: Math.random() * 60
			};
		});
		burstId += 1;
		if (clearTimer) clearTimeout(clearTimer);
		clearTimer = setTimeout(() => (particles = []), 700);
	}
</script>

<div class="flex gap-1.5 lg:gap-2">
	<span class="relative inline-flex">
		<button
			type="button"
			{disabled}
			onclick={() => {
				const next = status === 'done' ? null : 'done';
				if (next === 'done') fireBurst();
				onSet(next);
			}}
			aria-pressed={status === 'done'}
			aria-label={stripRuby(ui.check_done)}
			class="flex h-10 w-14 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 lg:h-12 lg:w-16
				{status === 'done'
				? 'border-emerald-500 bg-emerald-600 text-white'
				: 'border-border-dim bg-surface2 text-text-dim'}"
		>
			{#key burstId}
				<span class={burstId > 0 ? 'stamp-press' : ''}>
					<Circle size={22} strokeWidth={2.5} />
				</span>
			{/key}
		</button>
		{#if particles.length}
			<span class="pointer-events-none absolute inset-0" aria-hidden="true">
				{#each particles as p, i (`${burstId}|${i}`)}
					{#if p.star}
						<span
							class="star-fly absolute left-1/2 top-1/2 {p.color}"
							style="--dx:{p.dx}px; --dy:{p.dy}px; --rot:{p.rot}deg; animation-delay:{p.delay}ms"
						>
							<Star size={p.size + 6} fill="currentColor" />
						</span>
					{:else}
						<span
							class="star-fly absolute left-1/2 top-1/2 rounded-full bg-current {p.color}"
							style="width:{p.size}px; height:{p.size}px; --dx:{p.dx}px; --dy:{p.dy}px; --rot:{p.rot}deg; animation-delay:{p.delay}ms"
						></span>
					{/if}
				{/each}
			</span>
		{/if}
	</span>
	<button
		type="button"
		{disabled}
		onclick={() => onSet(status === 'not_done' ? null : 'not_done')}
		aria-pressed={status === 'not_done'}
		aria-label={stripRuby(ui.check_not_done)}
		class="flex h-10 w-14 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 lg:h-12 lg:w-16
			{status === 'not_done'
			? 'border-rose-500 bg-rose-600 text-white'
			: 'border-border-dim bg-surface2 text-text-dim'}"
	>
		<X size={22} strokeWidth={2.5} />
	</button>
	{#if cancelable}
		<button
			type="button"
			{disabled}
			onclick={() => onSet(status === 'cancelled' ? null : 'cancelled')}
			aria-pressed={status === 'cancelled'}
			aria-label={stripRuby(ui.check_cancelled_aria)}
			class="flex h-10 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors disabled:opacity-40 lg:h-12 lg:w-20
				{status === 'cancelled'
				? 'border-amber-500 bg-amber-600 text-white'
				: 'border-border-dim bg-surface2 text-text-dim'}"
		>
			<CloudRain size={18} strokeWidth={2.5} />
			<span class="text-[10px] font-bold leading-none lg:text-xs"><Ruby text={ui.check_cancelled} /></span>
		</button>
	{/if}
</div>

<style>
	/* 星はじけ: ボタン中心から放射（transform/opacity のみ＝モバイルでも軽量）。
	   delay 中に見えないよう基底 opacity:0、0% フレームで出す。 */
	.star-fly {
		animation: star-fly 0.5s ease-out forwards;
		opacity: 0;
		will-change: transform, opacity;
	}
	@keyframes star-fly {
		0% {
			transform: translate(-50%, -50%) scale(0.4) rotate(0deg);
			opacity: 1;
		}
		70% {
			opacity: 1;
		}
		100% {
			transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1)
				rotate(var(--rot));
			opacity: 0;
		}
	}
	/* スタンプ押し込み（◯にした瞬間の再マウントで1回再生） */
	.stamp-press {
		animation: stamp-press 0.25s ease-out;
	}
	@keyframes stamp-press {
		0% {
			transform: scale(1);
		}
		35% {
			transform: scale(0.82);
		}
		70% {
			transform: scale(1.1);
		}
		100% {
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.star-fly,
		.stamp-press {
			animation: none;
		}
	}
</style>

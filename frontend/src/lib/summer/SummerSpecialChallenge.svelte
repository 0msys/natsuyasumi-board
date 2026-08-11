<script lang="ts">
	// スペシャルチャレンジ: 宿題で100点をとると解放されるごほうび枠（1つ +25てん・最大200てん）。
	// base<100（unlocked=false）のあいだは鍵オーバーレイ＋ボタン disabled で操作できない。
	// 100点になると解放され、◯にした瞬間だけ星はじけ＋「ポンッ」（SummerCheckButtons と同じ演出）。
	// きょうの画面と過去日修正モーダル（SummerDayEditModal）で共用する。呼ぶ側は「その日の」
	// status・base100・bonus を渡す（モーダルは day.statuses から組む）。
	import { Circle, Dumbbell, HandHeart, Headphones, Lock, Music, Sparkles, Star } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { SummerCheckStatus, SummerSpecialChallenge, SummerUiText } from '$lib/api';
	import { playPop, unlockSummerSfx } from './sfx';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';

	let {
		ui,
		challenges,
		unlocked,
		bonus,
		scoreMax,
		disabled = false,
		onSet
	}: {
		ui: SummerUiText;
		challenges: SummerSpecialChallenge[];
		unlocked: boolean;
		bonus: number;
		// 1日の最大点（100 + 項目数 × 25）。「ぜんぶできたら○点まんてん」に入れる。
		// サーバ側でも差し替え済みなので、ここの fmt は基本 no-op（ui_text_for の但し書き参照）。
		scoreMax: number;
		// 解放されていても押させない（過去日モーダルの閲覧専用のあいだ）。unlocked を
		// false に潰して代用しないこと——鍵オーバーレイが出て「宿題を100点にしたら
		// あけられるよ」という嘘の理由が表示される。
		disabled?: boolean;
		onSet: (key: string, status: SummerCheckStatus) => void;
	} = $props();

	// 項目キー → アイコン（装飾は絵文字でなく lucide の SVG で揃える）
	const ICONS: Record<string, Component> = {
		piano: Music,
		otetsudai: HandHeart,
		eigo_cd: Headphones,
		tairyoku_ch: Dumbbell
	};

	type Particle = { dx: number; dy: number; rot: number; size: number; color: string; star: boolean; delay: number };
	const COLORS = ['text-amber-400', 'text-emerald-400', 'text-sky-400', 'text-rose-400', 'text-violet-400'];
	let particles = $state<Particle[]>([]);
	let burstKey = $state<string | null>(null); // いま星がはじけている項目の key
	let burstId = $state(0);
	let clearTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => () => {
		if (clearTimer) clearTimeout(clearTimer);
	});

	// ◯遷移の同期部で呼ぶ: 効果音（iOS 解放込み）＋星はじけ。reduced-motion では粒生成をスキップ。
	function fireBurst(key: string) {
		unlockSummerSfx();
		playPop();
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const n = 10;
		particles = Array.from({ length: n }, (_, i) => {
			const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6;
			const dist = 28 + Math.random() * 16;
			return {
				dx: Math.cos(angle) * dist,
				dy: Math.sin(angle) * dist - 6,
				rot: Math.random() * 260 - 130,
				size: 4 + Math.random() * 4,
				color: COLORS[i % COLORS.length],
				star: i % 2 === 0,
				delay: Math.random() * 60
			};
		});
		burstKey = key;
		burstId += 1;
		if (clearTimer) clearTimeout(clearTimer);
		clearTimer = setTimeout(() => (particles = []), 700);
	}

	function toggle(c: SummerSpecialChallenge) {
		const next = c.status === 'done' ? null : 'done';
		if (next === 'done') fireBurst(c.key);
		onSet(c.key, next);
	}
</script>

<section class="relative rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
		<h2 class="flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
			<Sparkles size={20} class="text-violet-500" /><Ruby text={ui.challenge_title} />
		</h2>
		{#if unlocked}
			<span class="flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-bold text-violet-500 lg:text-sm">
				<Star size={13} fill="currentColor" /><Ruby text={ui.challenge_bonus} />
			</span>
		{/if}
	</div>
	<p class="mb-3 text-xs text-text-dim lg:text-sm">
		{#if unlocked}
			<Ruby text={fmt(ui.challenge_all, { score_max: scoreMax })} />{#if bonus > 0}<span class="font-bold text-violet-500"> <Ruby text={fmt(ui.challenge_now, { bonus })} /></span>{/if}
		{:else}
			<Ruby text={ui.challenge_locked_hint} />
		{/if}
	</p>

	<div class="grid grid-cols-2 gap-2 lg:gap-3" class:opacity-40={!unlocked}>
		{#each challenges as c (c.key)}
			{@const Icon = ICONS[c.key] ?? Star}
			{@const done = c.status === 'done'}
			<div
				class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors lg:py-3
					{done ? 'border-violet-500/50 bg-violet-500/10' : 'border-border-dim bg-surface2/60'}"
			>
				<span class="flex min-w-0 items-center gap-2">
					<Icon size={20} class={done ? 'shrink-0 text-violet-500' : 'shrink-0 text-text-dim'} />
					<span class="truncate text-sm font-medium text-text-base lg:text-base" title={stripRuby(c.label)}><Ruby text={c.label} /></span>
				</span>
				<span class="relative inline-flex shrink-0">
					<button
						type="button"
						disabled={!unlocked || disabled}
						onclick={() => toggle(c)}
						aria-pressed={done}
						aria-label={stripRuby(c.label)}
						class="flex h-9 w-12 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 lg:h-10 lg:w-14
							{done ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-border-dim bg-surface text-text-dim'}"
					>
						{#key burstId}
							<span class={burstKey === c.key && burstId > 0 ? 'stamp-press' : ''}>
								<Circle size={20} strokeWidth={2.5} />
							</span>
						{/key}
					</button>
					{#if particles.length && burstKey === c.key}
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
			</div>
		{/each}
	</div>

	{#if !unlocked}
		<!-- ロックオーバーレイ: 鍵アイコン＋文言。ボタンは disabled 済みで二重に操作不可。 -->
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-surface/70 backdrop-blur-[1px] lg:rounded-xl">
			<Lock size={30} class="text-text-dim" />
			<span class="px-4 text-center text-sm font-bold text-text-base lg:text-base">
				<Ruby text={ui.challenge_locked_overlay} />
			</span>
		</div>
	{/if}
</section>

<style>
	/* 星はじけ（SummerCheckButtons と同一パターン: transform/opacity のみ・reduce で無効化）。 */
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
			transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1) rotate(var(--rot));
			opacity: 0;
		}
	}
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

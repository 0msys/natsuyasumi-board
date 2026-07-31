<script lang="ts">
	// 満点のお祝い: 全画面の花火＋「まんてん！」バナー＋効果音。親が bind:this で play() を呼ぶ。
	// Modal.svelte と同じ body 直下ポータル（祖先の transform が position:fixed の基準を奪う罠の回避）。
	// z-[120] は Modal(z-100/101) より上＝過去日修正モーダル経由で満点になっても見える。
	// pointer-events-none なので操作は一切塞がない。
	// reduced-motion（iPhone 省電力で強制される）では花火を生成せず、opacity のみの
	// やわらかい光＋バナーに縮退する（完全静止させない・音は鳴らす）。
	import { onDestroy } from 'svelte';
	import { Star } from '@lucide/svelte';
	import type { SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { playBoom, playTada, playWhistle } from './sfx';

	let { ui }: { ui: SummerUiText } = $props();

	type Spark = { dx: number; dy: number; size: number; delay: number };
	type Shell = {
		id: number;
		x: number; // vw
		y: number; // vh（破裂高さ）
		color: string;
		state: 'rise' | 'burst';
		sparks: Spark[];
	};

	// テーマと調和する打ち上げ色のローテーション（amber/rose/emerald/sky/accent）
	const SHELL_COLORS = ['#fbbf24', '#fb7185', '#34d399', '#38bdf8', 'var(--color-accent)'];

	let visible = $state(false);
	let banner = $state(false);
	// バナー文言の差し替え（null＝既定の満点文言。ランク到達時は play({title,subtitle}) で渡す）。
	// 既定値は描画側で ui から引く＝既定が2箇所に散らない。
	let bannerTitle = $state<string | null>(null);
	let bannerSubtitle = $state<string | null>(null);
	let reduced = $state(false);
	let shells = $state<Shell[]>([]);
	let playing = false;
	let shellSeq = 0;
	let timers: ReturnType<typeof setTimeout>[] = [];
	let portalEl: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (!portalEl) return;
		document.body.appendChild(portalEl);
		return () => portalEl?.remove();
	});
	onDestroy(() => timers.forEach(clearTimeout));

	function at(ms: number, fn: () => void) {
		timers.push(setTimeout(fn, ms));
	}

	function launchShell(i: number) {
		const id = ++shellSeq;
		const shell: Shell = {
			id,
			x: 10 + Math.random() * 80,
			y: 15 + Math.random() * 40,
			color: SHELL_COLORS[i % SHELL_COLORS.length],
			state: 'rise',
			sparks: []
		};
		shells = [...shells, shell];
		playWhistle();
		at(350, () => {
			const sparks = Array.from({ length: 26 }, (_, k) => {
				const angle = (k / 26) * Math.PI * 2 + Math.random() * 0.3;
				const dist = 60 + Math.random() * 90;
				return {
					dx: Math.cos(angle) * dist,
					dy: Math.sin(angle) * dist,
					size: 3 + Math.random() * 4,
					delay: Math.random() * 80
				};
			});
			shells = shells.map((s) => (s.id === id ? { ...s, state: 'burst' as const, sparks } : s));
			playBoom();
			at(1000, () => (shells = shells.filter((s) => s.id !== id)));
		});
	}

	/** 満点到達の瞬間に親が呼ぶ。再生中の多重呼び出しは無視（連打ガード）。
	 *  opts でバナー文言を差し替えられる（既定は満点。ランク到達時に title/subtitle を渡す）。 */
	export function play(opts?: { title?: string; subtitle?: string }): void {
		if (playing) return;
		playing = true;
		bannerTitle = opts?.title ?? null;
		bannerSubtitle = opts?.subtitle ?? null;
		reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		visible = true;
		banner = false;
		shells = [];
		if (!reduced) {
			// 6発を時差で打ち上げ（同時に動くのは最大2発≒粒60個以下・transform/opacity のみ）
			for (let i = 0; i < 6; i++) at(i * 420, () => launchShell(i));
		}
		at(600, () => {
			banner = true;
			playTada();
		});
		at(reduced ? 3000 : 4200, () => (banner = false));
		at(reduced ? 3400 : 4800, () => {
			visible = false;
			shells = [];
			playing = false;
		});
	}
</script>

{#if visible}
	<div
		bind:this={portalEl}
		class="pointer-events-none fixed inset-0 z-[120] overflow-hidden"
		aria-hidden="true"
	>
		{#if reduced}
			<div class="celebration-glow absolute inset-0"></div>
		{/if}
		{#each shells as sh (sh.id)}
			{#if sh.state === 'rise'}
				<span
					class="shell-rise absolute"
					style="left:{sh.x}vw; --burst-y:{sh.y}vh; background:{sh.color}"
				></span>
			{:else}
				<span class="absolute" style="left:{sh.x}vw; top:{sh.y}vh">
					<span class="burst-flash absolute" style="background:{sh.color}"></span>
					{#each sh.sparks as p, i (i)}
						<span
							class="spark absolute"
							style="width:{p.size}px; height:{p.size}px; background:{sh.color}; --dx:{p.dx}px; --dy:{p.dy}px; animation-delay:{p.delay}ms"
						></span>
					{/each}
				</span>
			{/if}
		{/each}
		{#if banner}
			<div class="absolute inset-0 flex items-center justify-center">
				<div
					class="banner-pop flex flex-col items-center gap-2 rounded-2xl bg-surface-solid/90 px-8 py-6 shadow-2xl"
				>
					<span class="flex items-center gap-2">
						<Star size={36} class="text-amber-500" fill="currentColor" />
						<span class="text-5xl font-bold text-amber-500 lg:text-6xl"><Ruby text={bannerTitle ?? ui.celebration_title} /></span>
						<Star size={36} class="text-amber-500" fill="currentColor" />
					</span>
					<span class="text-base font-semibold text-text-base lg:text-lg">
						<Ruby text={bannerSubtitle ?? ui.celebration_sub} />
					</span>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* 打ち上げ筋: 画面下端から破裂高さ（--burst-y）まで上昇 */
	.shell-rise {
		bottom: 0;
		width: 3px;
		height: 12vh;
		border-radius: 2px;
		opacity: 0.9;
		animation: shell-rise 0.35s ease-out forwards;
		will-change: transform;
	}
	@keyframes shell-rise {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(calc(-100vh + var(--burst-y) + 12vh));
		}
	}
	/* 破裂の閃光 */
	.burst-flash {
		left: -5px;
		top: -5px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		animation: burst-flash 0.35s ease-out forwards;
	}
	@keyframes burst-flash {
		from {
			transform: scale(1);
			opacity: 1;
		}
		to {
			transform: scale(7);
			opacity: 0;
		}
	}
	/* 火花: 放射＋末端でわずかに落下（transform/opacity のみ＝軽量） */
	.spark {
		left: 0;
		top: 0;
		border-radius: 50%;
		opacity: 0;
		animation: spark-fly 0.9s cubic-bezier(0.1, 0.6, 0.3, 1) forwards;
		will-change: transform, opacity;
	}
	@keyframes spark-fly {
		0% {
			transform: translate(0, 0) scale(1);
			opacity: 1;
		}
		70% {
			opacity: 0.9;
		}
		100% {
			transform: translate(var(--dx), calc(var(--dy) + 22px)) scale(0.5);
			opacity: 0;
		}
	}
	/* reduce 縮退: 空間移動なし・opacity だけのやわらかい光 */
	.celebration-glow {
		background: radial-gradient(circle at 50% 45%, rgba(251, 191, 36, 0.28), transparent 60%);
		animation: glow-fade 3s ease-in-out forwards;
	}
	@keyframes glow-fade {
		0% {
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.banner-pop {
		animation: banner-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes banner-pop {
		from {
			transform: scale(0.5);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@keyframes banner-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		/* バナーは拡大でなくフェードのみで出す（opacity は reduce でも残す方針） */
		.banner-pop {
			animation: banner-fade 0.4s ease-out;
		}
	}
</style>

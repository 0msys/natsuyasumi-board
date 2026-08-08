<script lang="ts">
	// きょうのがんばり: 100点満点スコア（決定的採点）＋定型の褒めメッセージ。
	// メッセージはサーバが決定的に組み立てて state に常に載せる（生成待ちなし）。
	// 「きく」で VOICEVOX 読み上げ（VOICEVOX が無いときはボタンごと出さない）。
	import { Crown, Sparkles, Volume2 } from '@lucide/svelte';
	import type { SummerComment, SummerScore, SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';

	let {
		ui,
		comment,
		todayScore,
		scoreMax,
		ttsAvailable,
		onListen
	}: {
		ui: SummerUiText;
		comment: SummerComment | null;
		todayScore: SummerScore | null;
		scoreMax: number; // 満点の上限（チャレンジ込み）
		ttsAvailable: boolean;
		onListen: () => void;
	} = $props();
</script>

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<h2 class="mb-3 flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
		<Sparkles size={20} class="text-accent" /><Ruby text={ui.comment_title} />
	</h2>

	{#if todayScore}
		{@const rainbow = todayScore.total > 100}
		{@const crowned = todayScore.total === scoreMax && scoreMax > 100}
		<div class="mb-2 flex items-end gap-2">
			{#if crowned}
				<span class="crown-bob mb-1 inline-flex"><Crown size={30} class="text-amber-400" fill="currentColor" /></span>
			{/if}
			<span class="text-4xl font-bold lg:text-5xl {rainbow ? 'rainbow-text' : 'text-accent'}">{todayScore.total}</span>
			<span class="pb-1 text-sm text-text-dim lg:text-base">
				<Ruby text={fmt(ui.score_of_max, { max: todayScore.unlocked ? scoreMax : 100 })} />
			</span>
		</div>
		{#if rainbow}
			<div class="rainbow-bar mb-2" aria-hidden="true"></div>
		{/if}
		{#if todayScore.unlocked && todayScore.bonus > 0}
			<p class="mb-3 text-xs text-text-base lg:text-sm">
				<Ruby text={ui.score_homework_label} /> <span class="font-bold">{todayScore.score}</span> ＋
				<Ruby text={ui.score_challenge_label} />
				<span class="font-bold text-violet-500">+{todayScore.bonus}</span>
			</p>
		{/if}
		<!-- 列数は採点区分の数に合わせる（判定は judge が持つ単一の真実源）。ここを固定すると、
		     区分を足し引きしたときに空の列が残ったり card が潰れたりする。Tailwind の
		     grid-cols-N は静的クラスしか拾えないので、列数は style で直接渡す。 -->
		<div
			class="mb-3 grid gap-1.5 lg:gap-2"
			style="grid-template-columns: repeat({todayScore.parts.length}, minmax(0, 1fr))"
		>
			{#each todayScore.parts as part (part.name)}
				<div class="rounded-lg bg-surface2/60 px-2 py-1.5 text-center">
					<div class="truncate text-[10px] text-text-dim lg:text-xs" title={stripRuby(part.label)}><Ruby text={part.label} /></div>
					<div class="text-sm font-bold text-text-base lg:text-base">
						{part.points}<span class="text-[10px] font-normal text-text-dim lg:text-xs">/{part.max_points}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if comment}
		<div class="flex items-start gap-2">
			<p class="mb-0 flex-1 rounded-lg bg-surface2/60 px-3 py-2 text-sm leading-relaxed text-text-base lg:text-lg">
				<Ruby text={comment.text} />
			</p>
			{#if ttsAvailable}
				<button
					type="button"
					onclick={onListen}
					aria-label={stripRuby(ui.listen_aria)}
					title={stripRuby(ui.listen_aria)}
					class="flex items-center justify-center self-stretch rounded-lg border border-border-dim bg-surface2 px-3 text-text-dim"
				>
					<Volume2 size={18} />
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	/* 100点超の「虹色に光る演出」＝発光(glow)でなく彩色で見せる（色そのもののコントラスト）。
	   数字を虹グラデでクリップし、ゆっくり流す。reduce では色は残して動きだけ止める。 */
	.rainbow-text {
		background-image: linear-gradient(
			90deg,
			#ef4444,
			#f59e0b,
			#eab308,
			#22c55e,
			#3b82f6,
			#8b5cf6,
			#ef4444
		);
		background-size: 200% 100%;
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
		animation: rainbow-slide 3s linear infinite;
	}
	.rainbow-bar {
		height: 4px;
		border-radius: 9999px;
		background-image: linear-gradient(
			90deg,
			#ef4444,
			#f59e0b,
			#eab308,
			#22c55e,
			#3b82f6,
			#8b5cf6,
			#ef4444
		);
		background-size: 200% 100%;
		animation: rainbow-slide 3s linear infinite;
	}
	@keyframes rainbow-slide {
		from {
			background-position: 0% 50%;
		}
		to {
			background-position: 200% 50%;
		}
	}
	/* 王冠のやさしい上下ゆれ（transform のみ）。 */
	.crown-bob {
		animation: crown-bob 1.6s ease-in-out infinite;
	}
	@keyframes crown-bob {
		0%,
		100% {
			transform: translateY(0) rotate(-4deg);
		}
		50% {
			transform: translateY(-3px) rotate(4deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rainbow-text,
		.rainbow-bar {
			animation: none;
		}
		.crown-bob {
			animation: none;
		}
	}
</style>

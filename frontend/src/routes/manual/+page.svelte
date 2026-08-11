<script lang="ts">
	// 親向けの操作マニュアル。デプロイや構築の話は置かず、画面の使いかただけを書く。
	//
	// api を一切呼ばない（+page.ts も置かない）。lite の静的ビルドにサーバ実装が
	// 混ざらないことを CI が grep で見張っているので、ここから $lib/api を
	// import しないこと。文言だけは $lib/manual/labels.ts が生成物から引く。
	//
	// 版の切り替えは、この画面が持つ edition ひとつだけ。既定はいま動いている版で、
	// 保存はしない（既定が常に正しいので、覚えさせると「ずっと違う版を見せられる」道ができる）。
	import { ArrowLeft, BookOpen } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { EDITIONS, runningEdition, type Edition } from '$lib/manual/edition';
	import { MANUAL_SECTIONS } from '$lib/manual/manualSections';
	import AdminSection from '$lib/manual/sections/AdminSection.svelte';
	import DailySection from '$lib/manual/sections/DailySection.svelte';
	import DataSection from '$lib/manual/sections/DataSection.svelte';
	import HistorySection from '$lib/manual/sections/HistorySection.svelte';
	import OverviewSection from '$lib/manual/sections/OverviewSection.svelte';
	import ProgressSection from '$lib/manual/sections/ProgressSection.svelte';
	import SetupSection from '$lib/manual/sections/SetupSection.svelte';
	import TroubleSection from '$lib/manual/sections/TroubleSection.svelte';

	let edition = $state<Edition>(runningEdition());
</script>

<svelte:head><title>つかいかた | なつやすみボード</title></svelte:head>

<div class="mx-auto max-w-3xl p-3 lg:p-6">
	<header class="mb-3 flex items-center justify-between gap-3">
		<h1 class="flex items-center gap-2 text-lg font-bold text-text-base lg:text-xl">
			<BookOpen size={20} class="text-accent" />つかいかた
		</h1>
		<a
			href={resolve('/')}
			class="flex shrink-0 items-center gap-1 text-sm text-text-dim hover:text-text-base"
		>
			<ArrowLeft size={16} />子どもページへ
		</a>
	</header>

	<!-- 版の切り替え。もくじから下の節へ飛んだ先でも押せるように粘着させる（1行ぶんだけ）。
	     role="tablist" にはしない: タブに対応する tabpanel が無く（版ごとの文章は8つの節の
	     中に散っている）、aria-controls の指す先が作れないため。素のラジオなら
	     「ラジオグループ・2つのうち1つ選択中」と正しく読まれ、矢印キーの移動も付いてくる。 -->
	<div
		class="sticky top-0 z-10 -mx-3 mb-4 border-b border-border-dim bg-bg px-3 py-2 lg:-mx-6 lg:px-6"
	>
		<fieldset class="flex flex-wrap items-center gap-2">
			<legend class="sr-only">どちらの版の説明を読むか</legend>
			<span class="text-xs text-text-dim lg:text-sm">お使いの版:</span>
			{#each EDITIONS as e (e.id)}
				<!-- input は sr-only なので、focus-visible のリングは label 側に出す
				     （付け忘れるとキーボードの現在位置が完全に見えなくなる）。 -->
				<label
					class="cursor-pointer rounded-full bg-surface2 px-3 py-1.5 text-xs font-bold text-text-dim has-[:checked]:bg-accent has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent lg:text-sm"
				>
					<input
						type="radio"
						name="manual-edition"
						value={e.id}
						bind:group={edition}
						class="sr-only"
					/>
					{e.label}
				</label>
			{/each}
		</fieldset>
	</div>

	<nav
		id="manual-toc"
		class="mb-4 scroll-mt-20 rounded-lg bg-surface p-4 lg:p-5"
		aria-labelledby="manual-toc-title"
	>
		<h2 id="manual-toc-title" class="mb-1 text-sm font-bold text-text-dim lg:text-base">もくじ</h2>
		<ol class="flex flex-col">
			{#each MANUAL_SECTIONS as s, i (s.id)}
				<li>
					<a
						href="#{s.id}"
						class="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-accent hover:bg-surface2 lg:text-base"
					>
						<span class="w-4 shrink-0 text-right text-text-dim">{i + 1}.</span>{s.label}
					</a>
				</li>
			{/each}
		</ol>
	</nav>

	<OverviewSection {edition} />
	<SetupSection {edition} />
	<DailySection {edition} />
	<ProgressSection {edition} />
	<!-- HistorySection だけ edition を取らない（両版で操作が同じ節）。 -->
	<HistorySection />
	<AdminSection {edition} />
	<DataSection {edition} />
	<TroubleSection {edition} />
</div>

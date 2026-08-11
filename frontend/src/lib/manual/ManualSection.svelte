<script lang="ts">
	// マニュアル1節の外枠。見出しは manualSections.ts から引くので、もくじとズレない。
	//
	// 本文の体裁は、ここの [&_p] などの派生ユーティリティでまとめて与えている。
	// 節の中には <p> が数十個あり、1つずつ同じクラス列を書くと本文が読めなくなるうえ、
	// 書き忘れた1つだけ字が大きい、という壊れ方をする。Tailwind の派生ユーティリティは
	// ふつうの子孫セレクタの CSS になるので、子コンポーネント（UiLabel 等）の中まで届く。
	import type { Snippet } from 'svelte';
	import { manualSectionLabel, type ManualSectionId } from './manualSections';

	let { id, children }: { id: ManualSectionId; children: Snippet } = $props();
</script>

<section
	{id}
	class="mb-4 scroll-mt-20 rounded-lg bg-surface p-4 text-sm leading-relaxed text-text-base lg:p-5 lg:text-base [&_h3]:mb-1 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-bold [&_h3]:first:mt-0 [&_li]:mb-1 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 lg:[&_h3]:text-lg"
>
	<h2 class="mb-3 border-b border-border-dim pb-2 text-lg font-bold text-text-base lg:text-xl">
		{manualSectionLabel(id)}
	</h2>
	{@render children()}
	<p class="mb-0 mt-4 text-right">
		<a href="#manual-toc" class="text-xs text-text-dim hover:text-text-base lg:text-sm"
			>↑ もくじへもどる</a
		>
	</p>
</section>

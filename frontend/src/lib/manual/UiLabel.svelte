<script lang="ts">
	// 画面に実際に出ているボタン・見出しを、見た目ごと本文に埋めるための札。
	// このマニュアルはスクリーンショットを持たない（撮った瞬間から古くなるため）ので、
	// 「どれのことを言っているか」はこの札と、アプリと同じ lucide アイコンで伝える。
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<span
	class="mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-surface2 px-1.5 py-0.5 align-middle text-[0.9em] font-bold text-text-base"
>
	{@render children()}
</span>

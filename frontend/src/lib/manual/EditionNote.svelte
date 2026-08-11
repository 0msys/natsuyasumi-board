<script lang="ts">
	// 版がちがうところの囲み。選んでいる版と一致するときだけ描く（＝DOM から消える）。
	//
	// 見た目で印を付けるのは、もくじから途中の節へ飛んできた親のため。上の切り替えを
	// 押した覚えがないまま読み始めると、「これは自分の版の話か？」が分からなくなる。
	import type { Snippet } from 'svelte';
	import { editionOnlyLabel, type Edition } from './edition';

	let {
		only,
		edition,
		children
	}: { only: Edition; edition: Edition; children: Snippet } = $props();
</script>

{#if edition === only}
	<div class="my-3 rounded-md border-l-4 border-accent bg-surface2 p-3">
		<p class="mb-1 text-xs font-bold text-accent lg:text-sm">{editionOnlyLabel(only)}</p>
		{@render children()}
	</div>
{/if}

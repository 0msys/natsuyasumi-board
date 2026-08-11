<script lang="ts">
	// 「こまったときは」の1件。開閉は素の <details> に任せる（JS を持たせない）。
	// $lib/admin/sections/DailyHomeworkSection.svelte の折りたたみと同じ作り。
	import type { Snippet } from 'svelte';

	let { q, children }: { q: string; children: Snippet } = $props();
</script>

<details class="mb-2 rounded-md border border-border-dim px-3 py-2">
	<summary class="cursor-pointer select-none font-bold text-text-base">{q}</summary>
	<div class="mt-2">
		{@render children()}
	</div>
</details>

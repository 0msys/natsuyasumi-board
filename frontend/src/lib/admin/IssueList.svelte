<script lang="ts">
	// validate 結果の表示（errors=保存できない / warnings=保存はできるが知らせる）。
	// path の先頭区画から該当タブへのリンクを付ける（?section= の同一ページ遷移）。
	// year は編集中の年（sectionHref がクエリに残す。落とすと別の年の画面に化ける）。
	import { CircleAlert, TriangleAlert } from '@lucide/svelte';
	import type { ValidationIssue } from '$lib/api';
	import { sectionForPath, sectionHref, sectionLabel } from './sectionDefs';

	let {
		errors,
		warnings,
		year
	}: { errors: ValidationIssue[]; warnings: ValidationIssue[]; year?: number | null } = $props();
</script>

{#if errors.length > 0 || warnings.length > 0}
	<div class="flex max-h-44 flex-col gap-1 overflow-y-auto scroll-elegant">
		{#each errors as issue}
			{@const sec = sectionForPath(issue.path)}
			<p class="flex items-start gap-1.5 text-sm text-danger">
				<TriangleAlert size={14} class="mt-0.5 shrink-0" />
				<span>
					{#if sec}<a
							href={sectionHref(sec, year)}
							data-sveltekit-noscroll
							class="font-bold underline">{sectionLabel(sec)}</a
						>：{/if}{issue.message}
				</span>
			</p>
		{/each}
		{#each warnings as issue}
			{@const sec = sectionForPath(issue.path)}
			<p class="flex items-start gap-1.5 text-sm text-warn">
				<CircleAlert size={14} class="mt-0.5 shrink-0" />
				<span>
					{#if sec}<a
							href={sectionHref(sec, year)}
							data-sveltekit-noscroll
							class="font-bold underline">{sectionLabel(sec)}</a
						>：{/if}{issue.message}
				</span>
			</p>
		{/each}
	</div>
{/if}

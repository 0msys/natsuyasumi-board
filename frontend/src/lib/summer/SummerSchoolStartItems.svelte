<script lang="ts">
	// 新学期のじゅんびチェックリスト（持参日でグルーピング）。
	import { Backpack, Check } from '@lucide/svelte';
	import type { SummerSchoolStartItem, SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { nextSchoolStartItem } from './schoolStart';
	import { fmt } from './uiText';
	import { mdOf } from './dateLabel';

	let {
		ui,
		items,
		onToggleFlag
	}: {
		ui: SummerUiText;
		items: SummerSchoolStartItem[];
		onToggleFlag: (itemKey: string) => void;
	} = $props();

	const groups = $derived.by(() => {
		const byDue = new Map<string, SummerSchoolStartItem[]>();
		for (const item of items) {
			const list = byDue.get(item.due) ?? [];
			list.push(item);
			byDue.set(item.due, list);
		}
		return [...byDue.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
	});

	const doneCount = $derived(items.filter((i) => i.done).length);
	// つぎにやること（＝いちばん期日が近い未了項目）。全部できていれば出さない
	const next = $derived(nextSchoolStartItem(items));
</script>

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<h2 class="mb-1 flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
		<Backpack size={20} class="text-accent" /><Ruby text={ui.school_start_title} />
	</h2>
	<p class="mb-3 text-xs text-text-dim lg:text-sm">
		<Ruby text={fmt(ui.school_start_done, { done: doneCount, total: items.length })} />
		{#if next}
			<br /><Ruby
				text={fmt(ui.school_start_next, { due: mdOf(next.due), item: next.label })}
			/>
		{/if}
	</p>
	{#each groups as [due, groupItems] (due)}
		<div class="mb-3 last:mb-0">
			<div class="mb-1 text-xs font-semibold text-text-dim lg:text-sm">
				<Ruby text={fmt(ui.school_start_due, { due: mdOf(due) })} />
			</div>
			<div class="flex flex-col gap-1 lg:gap-1.5">
				{#each groupItems as item (item.key)}
					<button
						type="button"
						onclick={() => onToggleFlag(item.key)}
						aria-pressed={item.done}
						class="flex items-center gap-2 rounded-lg bg-surface2/60 px-3 py-2 text-left"
					>
						<span
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border
								{item.done ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-border-dim bg-surface2 text-transparent'}"
						>
							<Check size={16} strokeWidth={3} />
						</span>
						<span class="text-sm text-text-base lg:text-base {item.done ? 'line-through opacity-60' : ''}">
							<Ruby text={item.label} />
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/each}
</section>

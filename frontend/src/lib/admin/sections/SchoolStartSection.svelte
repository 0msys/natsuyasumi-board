<script lang="ts">
	// 新学期タブ: 新学期じゅんび（school_start_items）。ラベル＋期日（due）。
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import ImpactWarnModal from '../ImpactWarnModal.svelte';
	import RubyTextInput from '../RubyTextInput.svelte';

	let {
		draft,
		gradeLevel,
		nameExceptions,
		usage
	}: {
		draft: AdminDraft;
		gradeLevel: number;
		nameExceptions: string;
		usage: Record<string, number>;
	} = $props();

	const doc = $derived(draft.doc!);
	const items = $derived(doc.school_start_items ?? []);

	let pendingDelete = $state<{ label: string; count: number; run: () => void } | null>(null);

	function requestDelete(label: string | undefined, count: number, run: () => void) {
		if (count > 0) pendingDelete = { label: label || '（名前なし）', count, run };
		else run();
	}
	function removeAt(i: number) {
		items.splice(i, 1);
		pendingDelete = null;
		draft.markDirty();
	}
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">新学期のじゅんび</h2>
	<p class="text-xs text-text-dim">
		新学期にむけたじゅんびのチェックです。期日は「持っていく日・やる日」を入れてください。
	</p>

	{#each items as item, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex items-start gap-1.5">
				<RubyTextInput
					value={item.label ?? ''}
					placeholder="例: うわばきをあらう"
					{gradeLevel}
					{nameExceptions}
					onInput={(v) => {
						item.label = v;
						draft.markDirty();
					}}
				/>
				<button
					type="button"
					aria-label="けす"
					title="けす"
					onclick={() =>
						requestDelete(item.label, item.key ? (usage[String(item.key)] ?? 0) : 0, () =>
							removeAt(i)
						)}
					class="shrink-0 rounded-md p-1.5 text-danger/70 hover:bg-surface2"
				>
					<Trash2 size={16} />
				</button>
			</div>
			<label class="flex items-center gap-2 text-xs text-text-dim">
				期日
				<input
					type="date"
					value={item.due ?? ''}
					onchange={(e) => {
						item.due = e.currentTarget.value;
						draft.markDirty();
					}}
					class="rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base"
				/>
			</label>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => {
			(doc.school_start_items ??= []).push({ key: null, label: '', due: '' });
			draft.markDirty();
		}}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />じゅんびをふやす
	</button>
</section>

{#if pendingDelete}
	<ImpactWarnModal
		label={pendingDelete.label}
		count={pendingDelete.count}
		onConfirm={() => pendingDelete?.run()}
		onClose={() => (pendingDelete = null)}
	/>
{/if}

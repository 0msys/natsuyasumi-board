<script lang="ts">
	// チャレンジタブ: スペシャルチャレンジ（special_challenges）のラベルのみのリスト。
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
	const items = $derived(doc.special_challenges ?? []);

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
	<h2 class="text-base font-bold text-text-base">スペシャルチャレンジ</h2>
	<p class="text-xs text-text-dim">
		宿題で100点をとった日にひらく、ボーナスのチャレンジ枠です（1つやると +25点）。
	</p>

	{#each items as item, i}
		<div class="flex items-start gap-1.5 rounded-lg bg-surface2/60 p-3">
			<RubyTextInput
				value={item.label ?? ''}
				placeholder="例: おてつだい"
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
	{/each}

	<button
		type="button"
		onclick={() => {
			(doc.special_challenges ??= []).push({ key: null, label: '' });
			draft.markDirty();
		}}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />チャレンジをふやす
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

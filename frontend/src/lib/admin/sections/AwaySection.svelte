<script lang="ts">
	// おでかけタブ: 帰省・旅行の期間（away）。start / end / label のリスト。
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import RubyTextInput from '../RubyTextInput.svelte';

	let {
		draft,
		gradeLevel,
		nameExceptions
	}: { draft: AdminDraft; gradeLevel: number; nameExceptions: string } = $props();

	const doc = $derived(draft.doc!);
	const entries = $derived(doc.away ?? []);
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">おでかけ</h2>
	<p class="text-xs text-text-dim">
		帰省や旅行の期間です。その日の画面と履歴に「おでかけ」と表示されます（点数の計算はいつもどおりです）。
	</p>

	{#each entries as entry, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex flex-wrap items-center gap-2">
				<input
					type="date"
					value={entry.start ?? ''}
					onchange={(e) => {
						entry.start = e.currentTarget.value;
						draft.markDirty();
					}}
					class="rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base"
				/>
				<span class="text-xs text-text-dim">〜</span>
				<input
					type="date"
					value={entry.end ?? ''}
					onchange={(e) => {
						entry.end = e.currentTarget.value;
						draft.markDirty();
					}}
					class="rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base"
				/>
				<button
					type="button"
					aria-label="けす"
					title="けす"
					onclick={() => {
						entries.splice(i, 1);
						draft.markDirty();
					}}
					class="ml-auto rounded-md p-1.5 text-danger/70 hover:bg-surface2"
				>
					<Trash2 size={16} />
				</button>
			</div>
			<RubyTextInput
				value={entry.label ?? ''}
				placeholder="例: おばあちゃんのいえ"
				{gradeLevel}
				{nameExceptions}
				onInput={(v) => {
					entry.label = v;
					draft.markDirty();
				}}
			/>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => {
			(doc.away ??= []).push({ start: '', end: '', label: '' });
			draft.markDirty();
		}}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />おでかけをふやす
	</button>
</section>

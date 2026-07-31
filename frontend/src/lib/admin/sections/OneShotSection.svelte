<script lang="ts">
	// いっかいものタブ: 一回ものの宿題（one_shot_homework）。
	// required=かならずやる / type=flag（ふつう）| count（かずをかぞえる→目標数）。
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import type { DocOneShot } from '../docTypes';
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
	const items = $derived(doc.one_shot_homework ?? []);

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
	function setType(item: DocOneShot, type: 'flag' | 'count') {
		item.type = type;
		if (type === 'count' && (typeof item.target !== 'number' || item.target < 1)) item.target = 1;
		draft.markDirty();
	}
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">いっかいものの宿題</h2>
	<p class="text-xs text-text-dim">
		夏休み中に1回やればよい宿題です。「かならずやる」を外すと、子どもが「やる/やらない」を選べる任意の宿題になります。
	</p>

	{#each items as item, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex items-start gap-1.5">
				<RubyTextInput
					value={item.label ?? ''}
					placeholder="例: あさがおのかんさつカード1まい"
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
			<div class="flex flex-wrap items-center gap-4">
				<label class="flex items-center gap-1.5 text-xs text-text-base">
					<input
						type="checkbox"
						checked={item.required !== false}
						onchange={(e) => {
							item.required = e.currentTarget.checked;
							draft.markDirty();
						}}
					/>
					かならずやる
				</label>
				<div class="flex items-center gap-1.5">
					<span class="text-xs text-text-dim">種類:</span>
					<button
						type="button"
						aria-pressed={(item.type ?? 'flag') === 'flag'}
						onclick={() => setType(item, 'flag')}
						class="rounded-md border px-2.5 py-1 text-xs {(item.type ?? 'flag') === 'flag'
							? 'border-accent bg-accent text-white'
							: 'border-border-dim bg-surface2 text-text-dim'}"
					>
						ふつう
					</button>
					<button
						type="button"
						aria-pressed={item.type === 'count'}
						onclick={() => setType(item, 'count')}
						class="rounded-md border px-2.5 py-1 text-xs {item.type === 'count'
							? 'border-accent bg-accent text-white'
							: 'border-border-dim bg-surface2 text-text-dim'}"
					>
						かずをかぞえる
					</button>
				</div>
				{#if item.type === 'count'}
					<div class="flex items-center gap-1.5">
						<span class="text-xs text-text-dim">目標</span>
						<input
							type="number"
							min="1"
							value={item.target ?? 1}
							onchange={(e) => {
								const v = Math.floor(Number(e.currentTarget.value));
								item.target = Number.isFinite(v) && v > 0 ? v : 1;
								draft.markDirty();
							}}
							class="w-16 rounded-md border border-border-dim bg-surface px-2 py-1 text-center text-sm text-text-base"
						/>
						<span class="text-xs text-text-dim">こ（さつ・まい など）</span>
					</div>
				{/if}
			</div>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => {
			(doc.one_shot_homework ??= []).push({ key: null, label: '', required: true, type: 'flag' });
			draft.markDirty();
		}}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />宿題をふやす
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

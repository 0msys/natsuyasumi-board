<script lang="ts">
	// えらぶ宿題タブ: 選択宿題（choice_homework）のグループ編集。
	// グループ名・さいてい点数（1〜選択肢数）・選択肢（ラベル＋カテゴリ。datalist で既存候補を提案）。
	import { Minus, Plus, Trash2, X } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import type { DocChoiceGroup, DocChoiceOption } from '../docTypes';
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
	const groups = $derived(doc.choice_homework ?? []);

	// 全グループ横断の既存カテゴリ（datalist の提案候補）
	const allCategories = $derived.by(() => {
		const set = new Set<string>();
		for (const g of groups) {
			for (const o of g.options ?? []) if (o.category) set.add(String(o.category));
		}
		return [...set];
	});

	let pendingDelete = $state<{ label: string; count: number; run: () => void } | null>(null);

	function requestDelete(label: string | undefined, count: number, run: () => void) {
		if (count > 0) pendingDelete = { label: label || '（名前なし）', count, run };
		else run();
	}
	function optionUsage(group: DocChoiceGroup, opt: DocChoiceOption): number {
		return group.key && opt.key ? (usage[`${group.key}.${opt.key}`] ?? 0) : 0;
	}
	function groupUsage(group: DocChoiceGroup): number {
		return (group.options ?? []).reduce((n, o) => n + optionUsage(group, o), 0);
	}
	function stepMin(group: DocChoiceGroup, delta: number) {
		const max = Math.max(1, (group.options ?? []).length || 1);
		const cur = typeof group.min_required === 'number' ? group.min_required : 1;
		group.min_required = Math.min(Math.max(1, cur + delta), max);
		draft.markDirty();
	}
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">えらぶ宿題</h2>
	<p class="text-xs text-text-dim">
		「この中からいくつかえらんでやる」形式の宿題です（例: 国語か図工のさくひんを1点いじょう）。
	</p>

	<datalist id="admin-choice-category-options">
		{#each allCategories as c (c)}<option value={c}></option>{/each}
	</datalist>

	{#each groups as group, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex items-start gap-1.5">
				<RubyTextInput
					value={group.label ?? ''}
					placeholder="例: 国語《こくご》か図工《ずこう》のさくひん"
					{gradeLevel}
					{nameExceptions}
					onInput={(v) => {
						group.label = v;
						draft.markDirty();
					}}
				/>
				<button
					type="button"
					aria-label="グループをけす"
					title="グループをけす"
					onclick={() =>
						requestDelete(group.label, groupUsage(group), () => {
							groups.splice(i, 1);
							pendingDelete = null;
							draft.markDirty();
						})}
					class="shrink-0 rounded-md p-1.5 text-danger/70 hover:bg-surface2"
				>
					<Trash2 size={16} />
				</button>
			</div>

			<div class="flex items-center gap-2">
				<span class="text-xs text-text-dim">この中から さいてい</span>
				<button
					type="button"
					aria-label="へらす"
					onclick={() => stepMin(group, -1)}
					class="rounded-md border border-border-dim p-1 text-text-dim hover:bg-surface2"
				>
					<Minus size={14} />
				</button>
				<span class="w-6 text-center text-sm font-bold text-text-base">{group.min_required ?? 1}</span>
				<button
					type="button"
					aria-label="ふやす"
					onclick={() => stepMin(group, 1)}
					class="rounded-md border border-border-dim p-1 text-text-dim hover:bg-surface2"
				>
					<Plus size={14} />
				</button>
				<span class="text-xs text-text-dim">点（こ）やる</span>
			</div>

			<div class="flex flex-col gap-1.5 pl-1">
				{#each group.options ?? [] as opt, j}
					<div class="flex flex-col gap-1 rounded-md bg-surface p-2 sm:flex-row sm:items-start sm:gap-1.5">
						<RubyTextInput
							value={opt.label ?? ''}
							placeholder="例: 絵《え》をかく"
							{gradeLevel}
							{nameExceptions}
							onInput={(v) => {
								opt.label = v;
								draft.markDirty();
							}}
						/>
						<div class="flex shrink-0 items-center gap-1.5">
							<input
								type="text"
								list="admin-choice-category-options"
								value={opt.category == null ? '' : String(opt.category)}
								oninput={(e) => {
									opt.category = e.currentTarget.value || null;
									draft.markDirty();
								}}
								placeholder="カテゴリ（任意）"
								class="w-40 rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
							/>
							<button
								type="button"
								aria-label="選択肢をけす"
								title="選択肢をけす"
								onclick={() =>
									requestDelete(opt.label, optionUsage(group, opt), () => {
										(group.options ?? []).splice(j, 1);
										pendingDelete = null;
										draft.markDirty();
									})}
								class="rounded-md p-1.5 text-danger/70 hover:bg-surface2"
							>
								<X size={14} />
							</button>
						</div>
					</div>
				{/each}
				<button
					type="button"
					onclick={() => {
						(group.options ??= []).push({ key: null, label: '', category: null });
						draft.markDirty();
					}}
					class="flex items-center gap-1 self-start rounded-md border border-dashed border-border-dim px-2 py-1 text-xs text-text-dim hover:bg-surface2"
				>
					<Plus size={13} />選択肢をふやす
				</button>
			</div>
		</div>
	{/each}

	<button
		type="button"
		onclick={() => {
			(doc.choice_homework ??= []).push({ key: null, label: '', min_required: 1, options: [] });
			draft.markDirty();
		}}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />グループをふやす
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

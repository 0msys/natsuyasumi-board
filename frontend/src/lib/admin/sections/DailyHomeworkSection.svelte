<script lang="ts">
	// しゅくだい（daily_homework）のリスト編集。
	// 各項目はラベル＋メモ欄定義（折りたたみ）: 「やった」の日に書きそえる入力欄の設計。
	// メモ欄 choice の選択肢 key はサーバ採番の対象外なのでクライアントで newKey('mo_') を振る。
	import { Plus, Trash2, X } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import { newKey, type DocMetaField } from '../docTypes';
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
	const items = $derived(doc.daily_homework ?? []);

	const META_TYPES: { value: 'text' | 'choice' | 'duration'; label: string }[] = [
		{ value: 'text', label: 'じゆうに書く' },
		{ value: 'choice', label: 'えらぶ' },
		{ value: 'duration', label: 'タイム' }
	];

	let pendingDelete = $state<{ label: string; count: number; run: () => void } | null>(null);

	function requestDelete(label: string | undefined, count: number, run: () => void) {
		if (count > 0) pendingDelete = { label: label || '（名前なし）', count, run };
		else run();
	}

	function add() {
		(doc.daily_homework ??= []).push({ key: null, label: '', meta: [] });
		draft.markDirty();
	}
	function removeAt(i: number) {
		items.splice(i, 1);
		pendingDelete = null;
		draft.markDirty();
	}
	function setFieldType(field: DocMetaField, type: 'text' | 'choice' | 'duration') {
		field.type = type;
		if (type === 'choice') field.options ??= [];
		draft.markDirty();
	}
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">しゅくだい</h2>
	<p class="text-xs text-text-dim">
		毎日やる宿題です（1日1回のチェック欄に出ます）。ここに入れた項目は、どれも同じ重みで
		採点されます（せいかつ50点＋しゅくだい50点）。
	</p>

	{#each items as item, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex items-start gap-1.5">
				<RubyTextInput
					value={item.label ?? ''}
					placeholder="例: おんどく"
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

			<details class="rounded-md border border-border-dim/60 px-2 py-1.5">
				<summary class="cursor-pointer select-none text-xs text-text-dim">
					メモ欄（{(item.meta ?? []).length}こ）— 「やった」の日に書きそえる入力欄
				</summary>
				<div class="mt-2 flex flex-col gap-2">
					{#each item.meta ?? [] as field, j}
						<div class="flex flex-col gap-2 rounded-md bg-surface p-2">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-xs text-text-dim">種類:</span>
								{#each META_TYPES as t (t.value)}
									<button
										type="button"
										aria-pressed={(field.type ?? 'text') === t.value}
										onclick={() => setFieldType(field, t.value)}
										class="rounded-md border px-2.5 py-1 text-xs {(field.type ?? 'text') === t.value
											? 'border-accent bg-accent text-white'
											: 'border-border-dim bg-surface2 text-text-dim'}"
									>
										{t.label}
									</button>
								{/each}
								<button
									type="button"
									aria-label="メモ欄をけす"
									title="メモ欄をけす"
									onclick={() => {
										(item.meta ?? []).splice(j, 1);
										draft.markDirty();
									}}
									class="ml-auto rounded-md p-1 text-danger/70 hover:bg-surface2"
								>
									<Trash2 size={14} />
								</button>
							</div>
							<div class="flex items-start gap-2">
								<span class="w-20 shrink-0 pt-1.5 text-xs text-text-dim">ラベル</span>
								<RubyTextInput
									value={field.label ?? ''}
									placeholder="例: 読《よ》んだ本《ほん》"
									{gradeLevel}
									{nameExceptions}
									onInput={(v) => {
										field.label = v;
										draft.markDirty();
									}}
								/>
							</div>
							{#if (field.type ?? 'text') === 'text'}
								<div class="flex items-start gap-2">
									<span class="w-20 shrink-0 pt-1.5 text-xs text-text-dim">うすい例文</span>
									<RubyTextInput
										value={field.placeholder ?? ''}
										placeholder="例: 本《ほん》のだいめいを書《か》こう"
										{gradeLevel}
										{nameExceptions}
										onInput={(v) => {
											field.placeholder = v || null;
											draft.markDirty();
										}}
									/>
								</div>
							{/if}
							{#if field.type === 'choice'}
								<div class="flex flex-col gap-1.5 pl-2">
									{#each field.options ?? [] as opt, k}
										<div class="flex items-start gap-1.5">
											<RubyTextInput
												value={opt.label ?? ''}
												placeholder="例: 足《た》し算《ざん》"
												{gradeLevel}
												{nameExceptions}
												onInput={(v) => {
													opt.label = v;
													draft.markDirty();
												}}
											/>
											<button
												type="button"
												aria-label="選択肢をけす"
												title="選択肢をけす"
												onclick={() => {
													(field.options ?? []).splice(k, 1);
													draft.markDirty();
												}}
												class="shrink-0 rounded-md p-1.5 text-danger/70 hover:bg-surface2"
											>
												<X size={14} />
											</button>
										</div>
									{/each}
									<button
										type="button"
										onclick={() => {
											(field.options ??= []).push({ key: newKey('mo_'), label: '' });
											draft.markDirty();
										}}
										class="flex items-center gap-1 self-start rounded-md border border-dashed border-border-dim px-2 py-1 text-xs text-text-dim hover:bg-surface2"
									>
										<Plus size={13} />選択肢をふやす
									</button>
								</div>
							{/if}
						</div>
					{/each}
					<button
						type="button"
						onclick={() => {
							(item.meta ??= []).push({ key: null, type: 'text', label: '', placeholder: null, options: [] });
							draft.markDirty();
						}}
						class="flex items-center gap-1 self-start rounded-md border border-dashed border-border-dim px-2 py-1 text-xs text-text-dim hover:bg-surface2"
					>
						<Plus size={13} />メモ欄をふやす
					</button>
				</div>
			</details>
		</div>
	{/each}

	<button
		type="button"
		onclick={add}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />項目をふやす
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

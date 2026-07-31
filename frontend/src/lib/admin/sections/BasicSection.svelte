<script lang="ts">
	// きほんタブ: よみがな・学年・期間3日付・よみあげの こえ。child / year は表示のみ
	// （名前の変更は一覧ページの rename・year は period.start から決まる）。
	import type { AdminDraft } from '../draft.svelte';
	import { GRADES } from '../docTypes';
	import VoicePicker from './VoicePicker.svelte';

	let { draft }: { draft: AdminDraft } = $props();

	const doc = $derived(draft.doc!);

	function setPeriod(key: 'start' | 'end' | 'first_day_of_school', value: string) {
		doc.period ??= { start: '', end: '', first_day_of_school: '' };
		doc.period[key] = value;
		draft.markDirty();
	}
</script>

<section class="flex flex-col gap-4 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">きほん</h2>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div>
			<p class="text-xs text-text-dim">名前</p>
			<p class="text-base font-bold text-text-base">{doc.child ?? draft.child}</p>
			<p class="mt-0.5 text-xs text-text-dim">名前の変更は、一覧ページの「名前の変更」からできます。</p>
		</div>
		<div>
			<p class="text-xs text-text-dim">年（西暦）</p>
			<p class="text-base font-bold text-text-base">{doc.year ?? draft.year}</p>
		</div>
	</div>

	<label class="flex flex-col gap-1">
		<span class="text-xs text-text-dim">よみがな</span>
		<input
			type="text"
			value={doc.child_kana ?? ''}
			oninput={(e) => {
				doc.child_kana = e.currentTarget.value;
				draft.markDirty();
			}}
			placeholder="ひらがなで（画面のよびかけ・読み上げに使います）"
			class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
		/>
	</label>

	<VoicePicker {draft} />

	<div class="flex flex-col gap-1">
		<span class="text-xs text-text-dim">学年</span>
		<div class="flex flex-wrap gap-1.5">
			{#each GRADES as g (g)}
				<button
					type="button"
					aria-pressed={doc.grade === g}
					onclick={() => {
						doc.grade = g;
						draft.markDirty();
					}}
					class="rounded-md border px-3 py-1.5 text-sm {doc.grade === g
						? 'border-accent bg-accent font-bold text-white'
						: 'border-border-dim bg-surface2 text-text-dim'}"
				>
					{g}
				</button>
			{/each}
		</div>
		<p class="text-xs text-text-dim">学年を変えると、表示できる漢字のはんい（ルビの警告）が変わります。</p>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<label class="flex flex-col gap-1">
			<span class="text-xs text-text-dim">なつやすみの初日</span>
			<input
				type="date"
				value={doc.period?.start ?? ''}
				onchange={(e) => setPeriod('start', e.currentTarget.value)}
				class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-text-dim">なつやすみの最終日</span>
			<input
				type="date"
				value={doc.period?.end ?? ''}
				onchange={(e) => setPeriod('end', e.currentTarget.value)}
				class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-text-dim">始業式</span>
			<input
				type="date"
				value={doc.period?.first_day_of_school ?? ''}
				onchange={(e) => setPeriod('first_day_of_school', e.currentTarget.value)}
				class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
			/>
		</label>
	</div>
	<p class="text-xs text-text-dim">初日 → 最終日 → 始業式 の順になっている必要があります。</p>
</section>

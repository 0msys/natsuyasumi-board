<script lang="ts">
	// 過去日の記録を見る・なおすモーダル（履歴グリッドの日タップで開く。共有 Modal を利用）。
	import Modal from '$lib/Modal.svelte';
	import type {
		SummerCheckStatus,
		SummerDailyHomework,
		SummerHabit,
		SummerHistoryDay,
		SummerMetaField,
		SummerUiText
	} from '$lib/api';
	import { Pencil } from '@lucide/svelte';
	import SummerCheckButtons from './SummerCheckButtons.svelte';
	import SummerMetaInputs from './SummerMetaInputs.svelte';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';
	import { mdOf } from './dateLabel';

	let {
		ui,
		day,
		habits,
		daily,
		practice,
		anchorY = null,
		onSet,
		onSetMeta,
		onClose
	}: {
		ui: SummerUiText;
		day: SummerHistoryDay;
		habits: SummerHabit[];
		daily: SummerDailyHomework[];
		practice: SummerDailyHomework[];
		anchorY?: number | null;
		onSet: (day: string, itemKey: string, status: SummerCheckStatus) => void;
		onSetMeta: (day: string, itemKey: string, fieldKey: string, value: string | number | null) => void;
		onClose: () => void;
	} = $props();

	// 過去日は「閲覧専用」で開き、「へんしゅう」を押して初めて編集できる（過去の実績を1タップで
	// 書き換える誤操作を防ぐ）。今日はモーダルから開いても従来どおり最初から編集可。モーダルは
	// 日タップのたびに再マウントされるためマウント時の is_today で初期化すれば十分（60秒ポーリングの
	// 再取得では day の identity は変わるが .day 同一なので再ロックしない）。
	// svelte-ignore state_referenced_locally
	let editing = $state(day.is_today);

	// その日に記録欄がある習慣か（edges=カード窓・range=期間限定・window なし=毎日）。
	// 日付は YYYY-MM-DD 文字列なので辞書順比較で日付比較になる。
	function habitHasSlot(h: SummerHabit): boolean {
		if (h.window === 'edges') return day.edges_window;
		if (h.window === 'range')
			return !!h.window_start && !!h.window_end && day.day >= h.window_start && day.day <= h.window_end;
		return true;
	}

	// その日に記録欄がある項目。habits はメモなし＝空配列。cancelable は「中止」ボタン用。
	const items = $derived<
		{ key: string; label: string; meta_fields: SummerMetaField[]; cancelable: boolean }[]
	>([
		...habits
			.filter(habitHasSlot)
			.map((h) => ({ key: h.key, label: h.label, meta_fields: [], cancelable: h.cancelable })),
		...daily.map((d) => ({ key: d.key, label: d.label, meta_fields: d.meta_fields, cancelable: false })),
		...practice.map((p) => ({ key: p.key, label: p.label, meta_fields: p.meta_fields, cancelable: false }))
	]);

	function dateLabel(iso: string): string {
		return `${mdOf(iso)}（${day.weekday}）`;
	}
</script>

<Modal {anchorY} {onClose} maxWidthPx={560} gutterRem={2} maxHeightVh={85} ariaLabel={stripRuby(ui.day_edit_aria)}>
	<div class="p-4 lg:p-5">
		<div class="mb-1 flex items-center justify-between gap-2">
			<h3 class="text-base font-bold text-text-base lg:text-lg">
				<Ruby text={fmt(ui.day_edit_title, { date: dateLabel(day.day) })} />
			</h3>
			{#if !day.is_today}
				{#if editing}
					<span
						class="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs font-semibold text-accent lg:text-sm"
					>
						<Pencil size={14} /><Ruby text={ui.day_edit_editing} />
					</span>
				{:else}
					<button
						type="button"
						onclick={() => (editing = true)}
						class="flex items-center gap-1 rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent lg:text-sm"
					>
						<Pencil size={14} /><Ruby text={ui.day_edit_button} />
					</button>
				{/if}
			{/if}
		</div>
		{#if day.away}
			<p class="mb-2 text-xs text-amber-500 lg:text-sm">
				<Ruby text={fmt(ui.day_edit_away, { away: day.away })} />
			</p>
		{/if}
		{#if !day.is_today && !editing}
			<p class="mb-2 text-xs text-text-dim lg:text-sm">
				<Ruby text={ui.day_edit_view_only} />
			</p>
		{/if}
		<div class="flex flex-col gap-1.5 lg:gap-2">
			{#each items as item (item.key)}
				<div class="rounded-lg bg-surface2/60 px-3 py-2">
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm text-text-base lg:text-base"><Ruby text={item.label} /></span>
						<SummerCheckButtons
							{ui}
							status={day.statuses[item.key] ?? null}
							disabled={!editing}
							cancelable={item.cancelable}
							onSet={(s) => onSet(day.day, item.key, s)}
						/>
					</div>
					{#if day.statuses[item.key] === 'done' && item.meta_fields.length}
						{#key day.day + ':' + item.key}
							<SummerMetaInputs
								{ui}
								fields={item.meta_fields}
								value={day.meta?.[item.key] ?? null}
								disabled={!editing}
								onSet={(fieldKey, v) => onSetMeta(day.day, item.key, fieldKey, v)}
							/>
						{/key}
					{/if}
				</div>
			{/each}
		</div>
		<div class="mt-4 text-right">
			<button
				type="button"
				onclick={onClose}
				class="rounded-lg border border-border-dim bg-surface2 px-4 py-2 text-sm text-text-base lg:text-base"
			>
				<Ruby text={ui.close} />
			</button>
		</div>
	</div>
</Modal>

<script lang="ts">
	// 宿題の全体像: 一回もの（チェック・読書カウンタ・やる/やらない）＋選択宿題＋反復の実施日数＋残り日数。
	import { BookMarked, Check, Minus, Plus } from '@lucide/svelte';
	import type {
		SummerChoiceGroup,
		SummerDailyHomework,
		SummerDecision,
		SummerOneShot,
		SummerUiText
	} from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';

	let {
		ui,
		oneShot,
		choiceGroups,
		practice,
		daily,
		progress,
		onToggleFlag,
		onSetCount,
		onSetDecision
	}: {
		ui: SummerUiText;
		oneShot: SummerOneShot[];
		choiceGroups: SummerChoiceGroup[];
		practice: SummerDailyHomework[];
		daily: SummerDailyHomework[];
		progress: { days_elapsed: number; days_total: number };
		onToggleFlag: (itemKey: string) => void;
		onSetCount: (itemKey: string, value: number) => void;
		onSetDecision: (itemKey: string, decision: SummerDecision) => void;
	} = $props();

	const pct = $derived(Math.round((progress.days_elapsed / progress.days_total) * 100));
</script>

{#snippet decisionButtons(key: string, decision: SummerDecision)}
	<div class="flex shrink-0 gap-1">
		<button
			type="button"
			onclick={() => onSetDecision(key, decision === 'do' ? null : 'do')}
			class="rounded-md border px-2 py-1 text-xs lg:text-sm
				{decision === 'do'
				? 'border-emerald-500 bg-emerald-600 text-white'
				: 'border-border-dim bg-surface2 text-text-dim'}"
		>
			<Ruby text={ui.decide_do} />
		</button>
		<button
			type="button"
			onclick={() => onSetDecision(key, decision === 'skip' ? null : 'skip')}
			class="rounded-md border px-2 py-1 text-xs lg:text-sm
				{decision === 'skip'
				? 'border-rose-500 bg-rose-600 text-white'
				: 'border-border-dim bg-surface2 text-text-dim'}"
		>
			<Ruby text={ui.decide_skip} />
		</button>
	</div>
{/snippet}

{#snippet doneCheck(key: string, done: boolean, disabled: boolean)}
	<button
		type="button"
		{disabled}
		onclick={() => onToggleFlag(key)}
		aria-pressed={done}
		aria-label={stripRuby(ui.done_aria)}
		class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-30 lg:h-9 lg:w-9
			{done ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-border-dim bg-surface2 text-text-dim'}"
	>
		<Check size={18} strokeWidth={3} />
	</button>
{/snippet}

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<h2 class="mb-3 flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
		<BookMarked size={20} class="text-accent" /><Ruby text={ui.homework_title} />
	</h2>

	<div class="mb-4">
		<div class="mb-1 flex justify-between text-xs text-text-dim lg:text-sm">
			<span>
				<Ruby
					text={fmt(ui.homework_progress_days, {
						elapsed: progress.days_elapsed,
						total: progress.days_total
					})}
				/>
			</span>
			<span>{pct}%</span>
		</div>
		<div class="h-2 overflow-hidden rounded-full bg-surface2">
			<div class="h-full rounded-full bg-accent" style="width:{pct}%"></div>
		</div>
	</div>

	<div class="flex flex-col gap-1.5 lg:gap-2">
		{#each oneShot as item (item.key)}
			<div
				class="flex items-center justify-between gap-2 rounded-lg bg-surface2/60 px-3 py-2 {item.decision === 'skip' ? 'opacity-50' : ''}"
			>
				<div class="min-w-0">
					<div class="text-sm text-text-base lg:text-base {item.done ? 'line-through opacity-70' : ''}">
						<Ruby text={item.label} />
					</div>
					{#if !item.required}
						<div class="text-[10px] text-text-dim lg:text-xs"><Ruby text={ui.homework_optional} /></div>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-2">
					{#if item.type === 'count'}
						<div class="flex items-center gap-1">
							<button
								type="button"
								onclick={() => onSetCount(item.key, Math.max(0, item.value - 1))}
								aria-label={stripRuby(ui.count_minus_aria)}
								class="flex h-8 w-8 items-center justify-center rounded-lg border border-border-dim bg-surface2 text-text-dim"
							>
								<Minus size={16} />
							</button>
							<span class="w-12 text-center text-sm font-bold lg:text-base {item.done ? 'text-emerald-500' : 'text-text-base'}">
								{item.value}/{item.target}
							</span>
							<button
								type="button"
								onclick={() => onSetCount(item.key, item.value + 1)}
								aria-label={stripRuby(ui.count_plus_aria)}
								class="flex h-8 w-8 items-center justify-center rounded-lg border border-border-dim bg-surface2 text-text-dim"
							>
								<Plus size={16} />
							</button>
						</div>
					{:else}
						{#if !item.required}
							{@render decisionButtons(item.key, item.decision)}
						{/if}
						{@render doneCheck(item.key, item.done, item.decision === 'skip')}
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#each choiceGroups as group (group.key)}
		<div class="mt-4">
			<div class="mb-1 flex items-center justify-between gap-2">
				<span class="min-w-0 text-xs font-semibold text-text-dim lg:text-sm"><Ruby text={group.label} /></span>
				<span class="shrink-0 whitespace-nowrap text-[10px] lg:text-xs {group.satisfied ? 'text-emerald-500' : 'text-amber-500'}">
					<Ruby text={group.satisfied ? ui.choice_satisfied : ui.choice_unsatisfied} />
				</span>
			</div>
			<div class="flex flex-col gap-1 lg:gap-1.5">
				{#each group.options as option (option.key)}
					<div
						class="flex items-center justify-between gap-2 rounded-lg bg-surface2/40 px-3 py-1.5 {option.decision === 'skip' ? 'opacity-50' : ''}"
					>
						<div class="min-w-0 text-xs text-text-base lg:text-sm {option.done ? 'line-through opacity-70' : ''}">
							{#if option.category}<span class="mr-1 text-text-dim">[<Ruby text={option.category} />]</span>{/if}<Ruby text={option.label} />
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{@render decisionButtons(option.key, option.decision)}
							{@render doneCheck(option.key, option.done, option.decision === 'skip')}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<div class="mt-4">
		<div class="mb-1 text-xs font-semibold text-text-dim lg:text-sm">
			<Ruby text={ui.homework_done_days_title} />
		</div>
		<div class="grid grid-cols-2 gap-1.5 lg:gap-2">
			{#each [...daily, ...practice] as hw (hw.key)}
				<div class="rounded-lg bg-surface2/40 px-3 py-1.5">
					<div class="truncate text-[10px] text-text-dim lg:text-xs" title={stripRuby(hw.label)}><Ruby text={hw.label} /></div>
					<div class="text-sm font-bold text-text-base lg:text-base">
						<Ruby text={fmt(ui.homework_done_days, { days: hw.done_days })} />
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

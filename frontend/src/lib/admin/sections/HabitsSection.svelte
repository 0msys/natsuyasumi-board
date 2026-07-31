<script lang="ts">
	// せいかつタブ: 生活習慣（habits）のリスト編集＋「はじめとおわりだけ」の窓の日数
	// ＋テレビタイマーの上限（子どもごと）。
	import { ChevronDown, ChevronUp, Plus, Trash2 } from '@lucide/svelte';
	import type { AdminDraft } from '../draft.svelte';
	import {
		formatMinutes,
		moveItem,
		EDGES_WINDOW_DAYS_DEFAULT,
		EDGES_WINDOW_DAYS_MAX,
		MEDIA_LIMIT_MINUTES_DEFAULT,
		MEDIA_LIMIT_MINUTES_MAX,
		type DefinitionDoc,
		type DocDailyItem
	} from '../docTypes';
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
	const habits = $derived(doc.habits ?? []);

	const WINDOW_CHOICES: { value: 'edges' | 'range' | null; label: string }[] = [
		{ value: null, label: '毎日' },
		{ value: 'edges', label: 'はじめとおわりだけ' },
		{ value: 'range', label: 'きかん限定' }
	];

	let pendingDelete = $state<{ label: string; count: number; run: () => void } | null>(null);

	function requestDelete(label: string | undefined, count: number, run: () => void) {
		if (count > 0) pendingDelete = { label: label || '（名前なし）', count, run };
		else run();
	}

	function add() {
		(doc.habits ??= []).push({ key: null, label: '', window: null, cancelable: false });
		draft.markDirty();
	}
	function move(i: number, delta: number) {
		if (moveItem(habits, i, delta)) draft.markDirty();
	}
	function removeAt(i: number) {
		habits.splice(i, 1);
		pendingDelete = null;
		draft.markDirty();
	}
	function setWindow(habit: DocDailyItem, value: 'edges' | 'range' | null) {
		habit.window = value;
		if (value === 'range') {
			habit.window_start ??= '';
			habit.window_end ??= '';
		}
		draft.markDirty();
	}

	/** 区画を「編集できるオブジェクト」にそろえる（壊れた定義も画面から直せるようにする）.
	 *
	 *  `??=` では不足する: null/undefined 以外——`[]` や `0` や文字列——は置き換わらないので、
	 *  配列なら付けたプロパティが JSON.stringify で落ち、数値・文字列なら strict mode の
	 *  代入で TypeError になる。どちらも「開けるのに保存できない子」になり、画面から
	 *  直す手段がなくなる（インポートした JSON が壊れていた場合の唯一の復旧経路がここ）。
	 */
	function ensureObject<K extends 'card_rules' | 'media_timer'>(key: K): NonNullable<DefinitionDoc[K]> {
		const cur = doc[key];
		if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) doc[key] = {};
		return doc[key]!;
	}

	const edgesWindowDays = $derived(
		typeof doc.card_rules?.edges_window_days === 'number'
			? doc.card_rules.edges_window_days
			: EDGES_WINDOW_DAYS_DEFAULT
	);

	function setEdgesWindowDays(days: number): number {
		const v = Math.max(1, Math.min(EDGES_WINDOW_DAYS_MAX, Math.floor(days) || 1));
		ensureObject('card_rules').edges_window_days = v;
		draft.markDirty();
		return v;
	}

	// テレビタイマー（アウトメディアの上限）。分が単一真実源で、時間表記は導出。
	const MEDIA_PRESETS = [30, 60, 90, 120, 180];
	const mediaLimit = $derived(
		typeof doc.media_timer?.limit_minutes === 'number'
			? doc.media_timer.limit_minutes
			: MEDIA_LIMIT_MINUTES_DEFAULT
	);

	function setMediaLimit(minutes: number): number {
		const v = Math.max(1, Math.min(MEDIA_LIMIT_MINUTES_MAX, Math.floor(minutes) || 1));
		ensureObject('media_timer').limit_minutes = v;
		draft.markDirty();
		return v;
	}
</script>

<section class="flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">せいかつ習慣</h2>
	<p class="text-xs text-text-dim">
		毎日のチェックに出す生活習慣です。ラベルは子どもが読む文なので、習った漢字＋ルビで書いてください。
	</p>

	{#each habits as habit, i}
		<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
			<div class="flex items-start gap-1.5">
				<RubyTextInput
					value={habit.label ?? ''}
					placeholder="例: はみがき（あさ）"
					{gradeLevel}
					{nameExceptions}
					onInput={(v) => {
						habit.label = v;
						draft.markDirty();
					}}
				/>
				<div class="flex shrink-0 items-center">
					<button
						type="button"
						aria-label="上へ"
						title="上へ"
						disabled={i === 0}
						onclick={() => move(i, -1)}
						class="rounded-md p-1.5 text-text-dim hover:bg-surface2 disabled:opacity-30"
					>
						<ChevronUp size={16} />
					</button>
					<button
						type="button"
						aria-label="下へ"
						title="下へ"
						disabled={i === habits.length - 1}
						onclick={() => move(i, 1)}
						class="rounded-md p-1.5 text-text-dim hover:bg-surface2 disabled:opacity-30"
					>
						<ChevronDown size={16} />
					</button>
					<button
						type="button"
						aria-label="けす"
						title="けす"
						onclick={() =>
							requestDelete(habit.label, habit.key ? (usage[String(habit.key)] ?? 0) : 0, () =>
								removeAt(i)
							)}
						class="rounded-md p-1.5 text-danger/70 hover:bg-surface2"
					>
						<Trash2 size={16} />
					</button>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="text-xs text-text-dim">記録欄を出す日:</span>
				{#each WINDOW_CHOICES as c (c.label)}
					<button
						type="button"
						aria-pressed={(habit.window ?? null) === c.value}
						onclick={() => setWindow(habit, c.value)}
						class="rounded-md border px-2.5 py-1 text-xs {(habit.window ?? null) === c.value
							? 'border-accent bg-accent text-white'
							: 'border-border-dim bg-surface2 text-text-dim'}"
					>
						{c.label}
					</button>
				{/each}
			</div>
			{#if habit.window === 'range'}
				<div class="flex flex-wrap items-center gap-2 text-xs text-text-dim">
					<input
						type="date"
						value={habit.window_start ?? ''}
						onchange={(e) => {
							habit.window_start = e.currentTarget.value;
							draft.markDirty();
						}}
						class="rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base"
					/>
					〜
					<input
						type="date"
						value={habit.window_end ?? ''}
						onchange={(e) => {
							habit.window_end = e.currentTarget.value;
							draft.markDirty();
						}}
						class="rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base"
					/>
				</div>
			{/if}
			<div class="flex flex-wrap gap-4">
				<label class="flex items-center gap-1.5 text-xs text-text-base">
					<input
						type="checkbox"
						checked={habit.cancelable === true}
						onchange={(e) => {
							habit.cancelable = e.currentTarget.checked;
							draft.markDirty();
						}}
					/>
					中止がありうる行事（中止の日は満点あつかい）
				</label>
			</div>
		</div>
	{/each}

	<button
		type="button"
		onclick={add}
		class="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-border-dim px-3 py-2 text-sm text-text-dim hover:bg-surface2"
	>
		<Plus size={16} />習慣をふやす
	</button>
</section>

<section class="mt-4 flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">はじめとおわりだけの日数</h2>
	<div class="flex items-center gap-2">
		<span class="text-sm text-text-base">はじめとおわりの日数</span>
		<input
			type="number"
			min="1"
			max={EDGES_WINDOW_DAYS_MAX}
			value={edgesWindowDays}
			onchange={(e) => {
				// clamp 後の値を DOM へ書き戻す。$derived が同じ値のままだと再描画されず、
				// 入力欄に打った 0 や 9999 が残ったまま実際の保存値とズレる。
				e.currentTarget.value = String(setEdgesWindowDays(Number(e.currentTarget.value)));
			}}
			class="w-20 rounded-md border border-border-dim bg-surface px-2 py-1 text-center text-sm text-text-base"
		/>
		<span class="text-xs text-text-dim">日</span>
	</div>
	<p class="text-xs text-text-dim">
		「はじめとおわりだけ」の習慣の記録欄を、休みのはじめとおわりに出す日数です。
	</p>
</section>

<section class="mt-4 flex flex-col gap-3 rounded-lg bg-surface p-4 lg:p-5">
	<h2 class="text-base font-bold text-text-base">テレビタイマー</h2>
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-sm text-text-base">1日に見ていい時間</span>
		<input
			type="number"
			min="1"
			max={MEDIA_LIMIT_MINUTES_MAX}
			value={mediaLimit}
			onchange={(e) => {
				// clamp 後の値を DOM へ書き戻す（上の日数欄と同じ理由）
				e.currentTarget.value = String(setMediaLimit(Number(e.currentTarget.value)));
			}}
			class="w-24 rounded-md border border-border-dim bg-surface px-2 py-1 text-center text-sm text-text-base"
		/>
		<span class="text-xs text-text-dim">分（{formatMinutes(mediaLimit)}）</span>
	</div>
	<div class="flex flex-wrap gap-1.5">
		{#each MEDIA_PRESETS as m (m)}
			<button
				type="button"
				aria-pressed={mediaLimit === m}
				onclick={() => setMediaLimit(m)}
				class="rounded-md border px-2.5 py-1 text-xs {mediaLimit === m
					? 'border-accent bg-accent text-white'
					: 'border-border-dim bg-surface2 text-text-dim'}"
			>
				{formatMinutes(m)}
			</button>
		{/each}
	</div>
	<p class="text-xs text-text-dim">
		子ども画面の「テレビタイマー」で、のこり時間の目安に使います（超えると時間の色が変わります）。
		テレビをつけている時間の記録なので、点数には入りません。
	</p>
	<p class="text-xs text-text-dim">
		時間を変えても、上の生活習慣のラベル（例「テレビ・ゲーム・タブレットは2時間まで」）は
		自動では変わりません。合わせたいときは書きなおしてください。
	</p>
</section>

{#if pendingDelete}
	<ImpactWarnModal
		label={pendingDelete.label}
		count={pendingDelete.count}
		onConfirm={() => pendingDelete?.run()}
		onClose={() => (pendingDelete = null)}
	/>
{/if}

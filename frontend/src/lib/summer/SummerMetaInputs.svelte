<script lang="ts">
	// 日次項目の追加メモ入力（「やった◯」を押した日に開く）。
	// type=text（本のだいめい）/choice（たしざん・ひきざん）/duration（分:秒）を描き分ける。
	// choice は prop 直結（サーバ確定を反映）。text・duration は入力中に 60秒ポーリングで
	// 消えないようローカルバッファを持ち、確定（blur/change）でサーバへ送る。
	// 初期化はマウント時の1回だけ。したがって「別の記録に切り替わったら作り直す」のは親の責任で、
	// 親は必ず {#key} で包むこと（今日の欄は child:itemKey、過去日モーダルは day:itemKey）。
	// 包み忘れると、同じ項目キーを持つ別の子・別の日へ切り替えたときにバッファが再利用され、
	// 前の記録の入力値が残ったまま blur で保存されてしまう。
	import type { SummerMetaField, SummerMeta, SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';

	let {
		ui,
		fields,
		value,
		disabled = false,
		onSet
	}: {
		ui: SummerUiText;
		fields: SummerMetaField[];
		value: SummerMeta | null;
		disabled?: boolean;
		onSet: (fieldKey: string, value: string | number | null) => void;
	} = $props();

	// svelte-ignore state_referenced_locally  ── マウント時の初期値でバッファを種まき（親が {#key} で再マウント）
	let textBuf = $state<Record<string, string>>(
		Object.fromEntries(
			fields
				.filter((f) => f.type === 'text')
				.map((f) => [f.key, value?.[f.key] != null ? String(value[f.key]) : ''])
		)
	);
	// svelte-ignore state_referenced_locally
	let durBuf = $state<Record<string, { m: number; s: number }>>(
		Object.fromEntries(
			fields
				.filter((f) => f.type === 'duration')
				.map((f) => {
					const n = Number(value?.[f.key] ?? 0) || 0;
					return [f.key, { m: Math.floor(n / 60), s: n % 60 }];
				})
		)
	);

	function commitText(key: string) {
		const t = (textBuf[key] ?? '').trim();
		onSet(key, t.length ? t : null);
	}
	function commitDuration(key: string) {
		const mm = Math.max(0, Math.min(Math.floor(durBuf[key].m || 0), 99));
		const ss = Math.max(0, Math.min(Math.floor(durBuf[key].s || 0), 59));
		const total = mm * 60 + ss;
		onSet(key, total > 0 ? total : null);
	}
</script>

<div class="mt-2 flex flex-col gap-2 rounded-lg bg-surface2/50 px-3 py-2">
	{#each fields as field (field.key)}
		<div class="flex items-center gap-2">
			<span class="w-14 shrink-0 text-xs text-text-dim lg:w-16 lg:text-sm"><Ruby text={field.label} /></span>
			{#if field.type === 'text'}
				<input
					type="text"
					bind:value={textBuf[field.key]}
					onblur={() => commitText(field.key)}
					placeholder={stripRuby(field.placeholder ?? '')}
					{disabled}
					class="min-w-0 flex-1 rounded-md border border-border-dim bg-surface px-2 py-1 text-sm text-text-base disabled:opacity-70 lg:text-base"
				/>
			{:else if field.type === 'choice'}
				<div class="flex gap-1.5">
					{#each field.options as opt (opt.key)}
						<button
							type="button"
							{disabled}
							onclick={() => onSet(field.key, value?.[field.key] === opt.key ? null : opt.key)}
							aria-pressed={value?.[field.key] === opt.key}
							class="rounded-md border px-2.5 py-1 text-xs disabled:opacity-70 lg:text-sm
								{value?.[field.key] === opt.key
								? 'border-accent bg-accent text-white'
								: 'border-border-dim bg-surface2 text-text-dim'}"
						>
							<Ruby text={opt.label} />
						</button>
					{/each}
				</div>
			{:else if field.type === 'duration'}
				<div class="flex items-center gap-1">
					<input
						type="number"
						min="0"
						max="99"
						inputmode="numeric"
						bind:value={durBuf[field.key].m}
						onchange={() => commitDuration(field.key)}
						{disabled}
						class="w-12 rounded-md border border-border-dim bg-surface px-1.5 py-1 text-center text-sm text-text-base disabled:opacity-70 lg:text-base"
					/>
					<span class="text-xs text-text-dim lg:text-sm"><Ruby text={ui.unit_minutes} /></span>
					<input
						type="number"
						min="0"
						max="59"
						inputmode="numeric"
						bind:value={durBuf[field.key].s}
						onchange={() => commitDuration(field.key)}
						{disabled}
						class="w-12 rounded-md border border-border-dim bg-surface px-1.5 py-1 text-center text-sm text-text-base disabled:opacity-70 lg:text-base"
					/>
					<span class="text-xs text-text-dim lg:text-sm"><Ruby text={ui.unit_seconds} /></span>
				</div>
			{/if}
		</div>
	{/each}
</div>

<script lang="ts">
	// 実施履歴グリッド: 期間全日（45日）× 全日次項目。行=項目・列=日付。
	// 過去日（今日含む）の列ヘッダをタップするとその日の修正モーダルを開く。
	// 全日を1行で横に並べ、横スクロールで全期間を見られるようにする（iPhoneも同じ）。
	// スタンプラリー: 満点(100)の日は末尾の点数行に星スタンプ、見出し横にれんぞく記録チップ。
	// 表の背景に日別スコアの推移グラフを敷く（x は列中心に DOM 実測で揃える。未記録日は欠測ギャップ）。
	import { CalendarRange, Circle, CloudRain, Flame, Star, X } from '@lucide/svelte';
	import type {
		SummerDailyHomework,
		SummerHabit,
		SummerHistoryDay,
		SummerStreaks,
		SummerUiText
	} from '$lib/api';
	import { periodLabel } from './dateLabel';
	import Ruby from './Ruby.svelte';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';

	let {
		ui,
		history,
		habits,
		daily,
		practice,
		streaks,
		scoreMax,
		onOpenDay
	}: {
		ui: SummerUiText;
		history: SummerHistoryDay[];
		habits: SummerHabit[];
		daily: SummerDailyHomework[];
		practice: SummerDailyHomework[];
		streaks: SummerStreaks;
		scoreMax: number; // グラフ y 軸の上限（チャレンジ込み。4項目で200）
		onOpenDay: (day: SummerHistoryDay, e: MouseEvent) => void;
	} = $props();

	// 行の並び: はみがき3行 → edges/range 習慣（窓内のみセル）→ 毎日宿題 → 反復宿題
	const rows = $derived([
		...habits.map((h) => ({
			key: h.key,
			label: h.label,
			window: h.window,
			windowStart: h.window_start,
			windowEnd: h.window_end
		})),
		...daily.map((d) => ({ key: d.key, label: d.label, window: null, windowStart: null, windowEnd: null })),
		...practice.map((p) => ({ key: p.key, label: p.label, window: null, windowStart: null, windowEnd: null }))
	]);

	// その行にその日 記録欄があるか（edges=カード窓・range=期間限定・window なし=毎日）。
	// 日付は YYYY-MM-DD 文字列なので辞書順比較で日付比較になる。
	function hasSlot(row: (typeof rows)[number], h: SummerHistoryDay): boolean {
		if (row.window === 'edges') return h.edges_window;
		if (row.window === 'range')
			return !!row.windowStart && !!row.windowEnd && h.day >= row.windowStart && h.day <= row.windowEnd;
		return true;
	}

	function dayNum(day: string): string {
		return String(Number(day.slice(8, 10)));
	}
	// 期間の見出し（左上の固定セル）。履歴の最初と最後の日から出す＝どの子の期間でも合う
	const period = $derived(periodLabel(history.map((h) => h.day)));

	function monthBoundary(i: number): boolean {
		return i > 0 && history[i].day.slice(5, 7) !== history[i - 1].day.slice(5, 7);
	}

	// ---- 背景グラフの座標: DOM 実測（左固定列幅が内容依存＋月境界 border-l-2 の 2px ずれがあるため
	// 列幅ハードコード不可）。SSR では走らず SVG なしで描画される。
	// svelte-ignore non_reactive_update
	let tableEl: HTMLTableElement | undefined;
	// svelte-ignore non_reactive_update
	let scoreRowEl: HTMLTableRowElement | undefined;
	let chart = $state<{ w: number; h: number; xs: number[]; yTop: number; yBottom: number } | null>(
		null
	);

	function measure() {
		if (!tableEl || !scoreRowEl) return;
		const ths = [...tableEl.querySelectorAll<HTMLElement>('thead tr:first-child th')].slice(1);
		chart = {
			w: tableEl.offsetWidth,
			h: tableEl.offsetHeight,
			xs: ths.map((th) => th.offsetLeft + th.offsetWidth / 2),
			yTop: tableEl.querySelector('thead')?.offsetHeight ?? 0,
			yBottom: scoreRowEl.offsetTop + scoreRowEl.offsetHeight
		};
	}
	$effect(() => {
		void history; // 履歴更新（スタンプ出現などで行高が変わる）でも再実測
		measure();
		const ro = new ResizeObserver(measure); // lg: 切替・フォントロード・リサイズに追従
		if (tableEl) ro.observe(tableEl);
		return () => ro.disconnect();
	});

	// スコア列 → SVG パス。null（未記録・未来日）は欠測ギャップとしてパスを分割し、0点に潰さない。
	// 孤立した1日だけの記録は線にならないためドットで示す。
	const graph = $derived.by(() => {
		if (!chart || !chart.xs.length) return null;
		const { w, h, xs, yTop, yBottom } = chart;
		// y 軸上限はチャレンジ込みの scoreMax（4項目で200）。total を折れ線にする。
		const yOf = (s: number) => yBottom - ((yBottom - yTop) * s) / scoreMax;
		const segs: { x: number; y: number }[][] = [];
		let cur: { x: number; y: number }[] = [];
		history.forEach((d, i) => {
			if (d.total === null || i >= xs.length) {
				if (cur.length) segs.push(cur);
				cur = [];
				return;
			}
			cur.push({ x: xs[i], y: yOf(d.total) });
		});
		if (cur.length) segs.push(cur);
		if (!segs.length) return null;
		const multi = segs.filter((s) => s.length > 1);
		return {
			w,
			h,
			line: multi.map((s) => 'M ' + s.map((p) => `${p.x} ${p.y}`).join(' L ')).join(' '),
			area: multi
				.map(
					(s) =>
						`M ${s[0].x} ${yBottom} L ` +
						s.map((p) => `${p.x} ${p.y}`).join(' L ') +
						` L ${s[s.length - 1].x} ${yBottom} Z`
				)
				.join(' '),
			dots: segs.filter((s) => s.length === 1).map((s) => s[0])
		};
	});
</script>

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<div class="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
		<h2 class="flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
			<CalendarRange size={20} class="text-accent" /><Ruby text={ui.history_title} />
		</h2>
		<div class="flex flex-wrap items-center gap-1.5 text-xs lg:text-sm">
			<span
				class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 text-text-base"
			>
				<Flame size={14} class="text-amber-500" /><Ruby
					text={fmt(ui.history_streak_current, { days: streaks.perfect_current })}
				/>
			</span>
			<span
				class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 text-text-base"
			>
				<Star size={14} class="text-amber-500" fill="currentColor" /><Ruby
					text={fmt(ui.history_streak_total, { times: streaks.perfect_total })}
				/>
			</span>
			<span
				class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 text-text-dim"
			>
				<Ruby text={fmt(ui.history_streak_best, { days: streaks.perfect_best })} />
			</span>
		</div>
	</div>
	<p class="mb-3 text-xs text-text-dim lg:text-sm">
		<Ruby text={ui.history_hint} />
	</p>
	<div class="scroll-elegant overflow-x-auto">
		<!-- relative z-0 でスタッキングコンテキストを作る（無いと -z の SVG が section 背景の裏に沈む）。
		     w-max で幅を表に合わせ、SVG も表と一緒に横スクロールさせる。 -->
		<div class="relative z-0 w-max">
			{#if graph}
				<svg
					class="pointer-events-none absolute inset-0 -z-[1]"
					viewBox="0 0 {graph.w} {graph.h}"
					width="100%"
					height="100%"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{#if graph.area}<path d={graph.area} class="fill-accent" fill-opacity="0.11" />{/if}
					{#if graph.line}<path
							d={graph.line}
							class="stroke-accent"
							fill="none"
							stroke-opacity="0.45"
							stroke-width="2"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>{/if}
					{#each graph.dots as d, i (i)}
						<circle cx={d.x} cy={d.y} r="2.5" class="fill-accent" fill-opacity="0.45" />
					{/each}
				</svg>
			{/if}
			<table bind:this={tableEl} class="border-separate border-spacing-0 text-center">
				<thead>
					<tr>
						<th class="sticky left-0 z-10 bg-surface-solid pr-2 text-left text-xs font-semibold text-text-dim">
							{period}
						</th>
						{#each history as h, i (h.day)}
							<th class="px-0 {monthBoundary(i) ? 'border-l-2 border-border-dim' : ''}">
								<button
									type="button"
									disabled={h.is_future}
									onclick={(e) => onOpenDay(h, e)}
									class="flex h-9 w-7 flex-col items-center justify-center rounded text-[10px] leading-tight disabled:opacity-35 lg:h-10 lg:w-8 lg:text-xs
										{h.is_today ? 'bg-accent/20 font-bold text-accent' : h.away ? 'bg-amber-500/15 text-text-dim' : 'text-text-dim'}"
									title={h.away ? `${h.day}（${stripRuby(h.away)}）` : h.day}
								>
									<span>{dayNum(h.day)}</span>
									<span>{h.weekday}</span>
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.key)}
						<tr>
							<th
								class="sticky left-0 z-10 max-w-40 truncate bg-surface-solid pr-2 text-left text-xs font-normal text-text-dim lg:max-w-56 lg:text-sm"
								title={stripRuby(row.label)}
							>
								<Ruby text={row.label} />
							</th>
							{#each history as h, i (h.day)}
								<td class="h-7 w-7 lg:h-8 lg:w-8 {monthBoundary(i) ? 'border-l-2 border-border-dim' : ''}">
									{#if !hasSlot(row, h)}
										<!-- 記録欄がない日（その項目の窓外＝チェック欄が無い） -->
									{:else if h.statuses[row.key] === 'done'}
										<!-- やった印は塗りつぶし（スタンプラリーの「押した」感。中抜きだと未記録の点と
										     見分けが付きにくく、離れたタブレットからも読みにくい） -->
										<Circle size={14} class="mx-auto text-emerald-500" fill="currentColor" />
									{:else if h.statuses[row.key] === 'cancelled'}
										<CloudRain size={14} strokeWidth={2.5} class="mx-auto text-amber-500" />
									{:else if h.statuses[row.key] === 'not_done'}
										<X size={14} strokeWidth={3} class="mx-auto text-rose-500" />
									{:else if !h.is_future}
										<span class="mx-auto block h-1 w-1 rounded-full bg-border-dim"></span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
					<!-- 点数行: 日別スコア（満点は星スタンプ・未記録は 0 でなく未記入ドット） -->
					<tr bind:this={scoreRowEl}>
						<th class="sticky left-0 z-10 bg-surface-solid pr-2 text-left text-xs font-normal text-text-dim lg:text-sm">
							<Ruby text={ui.history_score_row} />
						</th>
						{#each history as h, i (h.day)}
							<td class="h-9 lg:h-10 {monthBoundary(i) ? 'border-l-2 border-border-dim' : ''}">
								{#if h.score === 100}
									<!-- 満点(Star)は base==100 のとき（満点＝100 は不変）・数字はチャレンジ込み total -->
									<span class="stamp-in mx-auto flex w-max flex-col items-center leading-none">
										<Star size={15} class="text-amber-500" fill="currentColor" />
										<span class="text-[8px] font-bold text-amber-600 lg:text-[9px]">{h.total}</span>
									</span>
								{:else if h.total !== null}
									<span
										class="text-[9px] font-medium lg:text-[10px] {h.total >= 80
											? 'text-text-base'
											: 'text-text-dim'}"
									>
										{h.total}
									</span>
								{:else if !h.is_future}
									<span class="mx-auto block h-1 w-1 rounded-full bg-border-dim"></span>
								{/if}
							</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</section>

<style>
	/* 満点スタンプの出現ポップ（その日が満点になった瞬間の再マウントで1回だけ再生）。
	   reduce では動きを止め、amber の色コントラストだけで満点を示す。 */
	.stamp-in {
		animation: stamp-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes stamp-in {
		from {
			transform: scale(2.4);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.stamp-in {
			animation: none;
		}
	}
</style>

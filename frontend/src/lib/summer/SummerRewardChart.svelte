<script lang="ts">
	// ごほうびランク: 総積み上げ点数（縦0〜9000・横45日）の専用グラフ。
	// レイヤ（下→上）: ランク帯（amber 単一色相の opacity 階段＝順序データ・CVD安全）／帰省帯（中立色）／
	//   ペース点線4本（各ランクへ0から対角）／積み上げ実績線（accent・面つき）／今日の縦線／x軸ラベル／ホバー層。
	// 専用カードなので DOM 実測は不要。div の実ピクセル（clientWidth/Height）を viewBox にして 1SVG単位=1CSSpx
	//   ＝テキスト歪みなし。SSR（w=0）では SVG を描かずヘッダのみ出す。
	import { Trophy } from '@lucide/svelte';
	import type { SummerHistoryDay, SummerRewards, SummerUiText } from '$lib/api';
	import Ruby from './Ruby.svelte';
	import { chartTopValue } from './rewardChartScale';
	import { stripRuby } from './ruby';
	import { fmt } from './uiText';
	import { mdOf } from './dateLabel';

	// SVG の <text> の中では <ruby> が効かないので、グラフ内の文字は stripRuby() で
	// よみ（かな）を出す。よみは全学年で同じなので学年による見え方の食い違いは起きない。
	let {
		ui,
		rewards,
		history
	}: { ui: SummerUiText; rewards: SummerRewards; history: SummerHistoryDay[] } = $props();

	// svelte-ignore non_reactive_update
	let svgEl: SVGSVGElement | undefined;
	let w = $state(0);
	let hpx = $state(0);
	let hoverIdx = $state<number | null>(null);

	// ランク帯の opacity 階段（下位→上位で濃く＝順序を明度で表す単一色相ランプ）
	const BAND_OPACITY = [0.05, 0.09, 0.14, 0.2];

	const geo = $derived.by(() => {
		const n = history.length;
		if (!(w > 0) || !(hpx > 0) || n < 2) return null;
		// 縦軸の上端。1日の上限を超える平均点のランク（検証は警告どまりで保存できる）があると
		// max_total より上のしきい値が来るので、そのぶん伸ばす。ふだんは max_total のまま。
		const maxTotal = chartTopValue(rewards);
		const ML = 6;
		const MR = 46; // 右端のランクしきい値ラベル（例「S 8100」）用
		const MT = 12;
		const MB = 18; // 下の x 軸ラベル用
		const plotW = Math.max(1, w - ML - MR);
		const plotH = Math.max(1, hpx - MT - MB);
		const x = (i: number) => ML + (plotW * i) / (n - 1);
		const y = (v: number) => MT + plotH * (1 - v / maxTotal);
		const step = plotW / (n - 1);
		const baseY = y(0);

		// ランク帯: しきい値 → 次のしきい値（最上位は maxTotal まで）。ラベルは各しきい値の高さに置く。
		const bands = rewards.ranks.map((r, i) => {
			const upper = i + 1 < rewards.ranks.length ? rewards.ranks[i + 1].threshold : maxTotal;
			const yTop = y(upper);
			return {
				key: r.key,
				yTop,
				h: Math.max(0, y(r.threshold) - yTop),
				opacity: BAND_OPACITY[i] ?? 0.2,
				label: r.key.toUpperCase(),
				threshold: r.threshold,
				yThresh: y(r.threshold)
			};
		});

		// 帰省帯: away 連続区間（前後を半日ぶん広げて日の列を覆う）
		const runs: { s: number; e: number }[] = [];
		let start = -1;
		history.forEach((h, i) => {
			if (h.away) {
				if (start < 0) start = i;
			} else if (start >= 0) {
				runs.push({ s: start, e: i - 1 });
				start = -1;
			}
		});
		if (start >= 0) runs.push({ s: start, e: n - 1 });
		const awayRects = runs.map((a) => {
			const left = Math.max(ML, x(a.s) - step / 2);
			const right = Math.min(ML + plotW, x(a.e) + step / 2);
			return { x: left, w: Math.max(0, right - left), cx: (left + right) / 2 };
		});

		// ペース点線: 0（初日）→ 各ランクしきい値（最終日）への対角
		const pace = rewards.ranks.map((r) => ({ x1: x(0), y1: baseY, x2: x(n - 1), y2: y(r.threshold) }));

		// 積み上げ実績線（キャリーフォワードで連続＝単一ポリライン）
		const pts: { x: number; y: number; v: number }[] = [];
		history.forEach((_, i) => {
			const v = rewards.cumulative[i];
			if (v !== null && v !== undefined) pts.push({ x: x(i), y: y(v), v });
		});
		const line = pts.length ? 'M ' + pts.map((p) => `${p.x} ${p.y}`).join(' L ') : '';
		const area =
			pts.length > 1
				? `M ${pts[0].x} ${baseY} L ` +
					pts.map((p) => `${p.x} ${p.y}`).join(' L ') +
					` L ${pts[pts.length - 1].x} ${baseY} Z`
				: '';
		const lastPt = pts.length ? pts[pts.length - 1] : null;
		// 現在値ラベル: 点が左端寄りなら右側に、右端寄りなら左側に置いて枠外へはみ出させない。
		// 上端に近ければ下げてクランプ（高得点時に帯外へ出ない）。
		const last = lastPt
			? {
					x: lastPt.x,
					y: lastPt.y,
					v: lastPt.v,
					labelX: lastPt.x < ML + plotW * 0.25 ? lastPt.x + 7 : lastPt.x - 6,
					labelAnchor: lastPt.x < ML + plotW * 0.25 ? 'start' : 'end',
					labelY: Math.max(MT + 10, lastPt.y - 8)
				}
			: null;

		// 今日の縦線
		const todayIdx = history.findIndex((h) => h.is_today);
		const todayX = todayIdx >= 0 ? x(todayIdx) : null;

		// x 軸ラベル: 期間端＋8/1・8/15（年に依存しないよう接尾辞で拾う）
		const ticks: number[] = [];
		const seen = new Set<number>();
		const add = (i: number) => {
			if (i >= 0 && i < n && !seen.has(i)) {
				seen.add(i);
				ticks.push(i);
			}
		};
		add(0);
		history.forEach((h, i) => {
			if (h.day.endsWith('-08-01') || h.day.endsWith('-08-15')) add(i);
		});
		add(n - 1);
		ticks.sort((a, b) => a - b);
		// 端のラベルは start/end アンカーで枠外にはみ出させない（左端「7/18」の切れ防止）
		const xticks = ticks.map((i, k) => ({
			x: x(i),
			label: mdOf(history[i].day),
			anchor: k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'
		}));

		return {
			n,
			ML,
			MR,
			MT,
			plotW,
			plotH,
			maxTotal,
			x,
			y,
			baseY,
			topY: y(maxTotal),
			bands,
			awayRects,
			pace,
			line,
			area,
			last,
			todayX,
			xticks
		};
	});

	const hover = $derived.by(() => {
		const g = geo;
		if (hoverIdx === null || !g) return null;
		const day = history[hoverIdx].day;
		const v = rewards.cumulative[hoverIdx];
		const has = v !== null && v !== undefined;
		const hx = g.x(hoverIdx);
		const label = `${mdOf(day)}: ${
			has ? stripRuby(fmt(ui.chart_points, { points: v as number })) : stripRuby(ui.chart_tooltip_future)
		}`;
		// ツールチップは幅を推定してプロット内に収める
		const tw = Math.min(g.plotW, label.length * 8 + 14);
		const tx = Math.max(g.ML, Math.min(hx - tw / 2, g.ML + g.plotW - tw));
		return { hx, hy: has ? g.y(v as number) : null, has, label, tx, tw, ty: g.MT + 2 };
	});

	// 達成済み最大ランク・次の目標・ペース到達ランク（ヘッダのチップ用）
	const achievedRank = $derived(
		rewards.achieved_key ? rewards.ranks.find((r) => r.key === rewards.achieved_key) : null
	);
	const nextRank = $derived(rewards.ranks.find((r) => !r.achieved) ?? null);
	const paceRank = $derived(
		rewards.pace_key ? rewards.ranks.find((r) => r.key === rewards.pace_key) : null
	);

	function onMove(e: PointerEvent) {
		const g = geo;
		if (!g || !svgEl) return;
		const r = svgEl.getBoundingClientRect();
		const sx = ((e.clientX - r.left) * w) / (r.width || 1);
		let i = Math.round(((sx - g.ML) / g.plotW) * (g.n - 1));
		i = Math.max(0, Math.min(g.n - 1, i));
		hoverIdx = i;
	}
</script>

<section class="rounded-lg bg-surface p-4 lg:rounded-xl lg:p-6">
	<div class="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
		<h2 class="flex items-center gap-2 text-base font-bold text-text-base lg:text-xl">
			<Trophy size={20} class="text-amber-500" /><Ruby text={ui.reward_title} />
		</h2>
		<div class="flex flex-wrap items-center gap-1.5 text-xs lg:text-sm">
			<span
				class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 font-semibold text-text-base"
			>
				<Ruby text={fmt(ui.reward_now, { total: rewards.total })} />
			</span>
			{#if achievedRank}
				<span
					class="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-amber-600"
				>
					<Trophy size={13} class="text-amber-500" /><Ruby
						text={fmt(ui.reward_achieved, { rank: achievedRank.label })}
					/>
				</span>
			{:else if nextRank}
				<span
					class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 text-text-dim"
				>
					<Ruby
						text={fmt(ui.reward_next, {
							rank: nextRank.label,
							rest: nextRank.threshold - rewards.total
						})}
					/>
				</span>
			{/if}
			{#if paceRank}
				<span
					class="flex items-center gap-1 rounded-full border border-border-dim bg-surface2 px-2 py-0.5 text-text-dim"
				>
					<Ruby text={fmt(ui.reward_pace, { rank: paceRank.label })} />
				</span>
			{/if}
		</div>
	</div>
	<p class="mb-3 text-xs text-text-dim lg:text-sm">
		<Ruby text={ui.reward_hint} />
	</p>

	<div class="relative h-56 lg:h-80" bind:clientWidth={w} bind:clientHeight={hpx}>
		{#if geo}
			<svg
				bind:this={svgEl}
				class="absolute inset-0"
				viewBox="0 0 {w} {hpx}"
				width="100%"
				height="100%"
				role="img"
				aria-label={stripRuby(fmt(ui.reward_chart_aria, { total: rewards.total })) +
					(paceRank ? stripRuby(fmt(ui.reward_chart_aria_pace, { rank: paceRank.label })) : '')}
			>
				<!-- 1. ランク帯（amber 単一色相の opacity 階段）＋右端しきい値ラベル -->
				{#each geo.bands as b (b.key)}
					<rect x={geo.ML} y={b.yTop} width={geo.plotW} height={b.h} class="fill-amber-500" fill-opacity={b.opacity} />
					<text
						x={geo.ML + geo.plotW + 4}
						y={b.yThresh}
						dominant-baseline="middle"
						class="fill-text-dim text-[9px] lg:text-[10px]"
					>
						{b.label} {b.threshold}
					</text>
				{/each}

				<!-- 2. 帰省帯（中立色。amber はランク専用） -->
				{#each geo.awayRects as a, i (i)}
					<rect x={a.x} y={geo.topY} width={a.w} height={geo.baseY - geo.topY} class="fill-text-dim" fill-opacity="0.08" />
					<text x={a.cx} y={geo.topY + 10} text-anchor="middle" class="fill-text-dim text-[8px] lg:text-[9px]">
						{stripRuby(ui.chart_away)}
					</text>
				{/each}

				<!-- 3. ペース点線4本（0→各しきい値への対角） -->
				{#each geo.pace as p, i (i)}
					<line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} class="stroke-amber-500" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="4 4" />
				{/each}

				<!-- 4. 積み上げ実績線＋面 -->
				{#if geo.area}<path d={geo.area} class="fill-accent" fill-opacity="0.1" />{/if}
				{#if geo.line}<path d={geo.line} class="stroke-accent" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />{/if}
				{#if geo.last}
					<circle cx={geo.last.x} cy={geo.last.y} r="4" class="fill-accent" />
					<text
						x={geo.last.labelX}
						y={geo.last.labelY}
						text-anchor={geo.last.labelAnchor}
						class="fill-text-base text-[10px] font-bold lg:text-xs"
					>
						{stripRuby(fmt(ui.chart_points, { points: geo.last.v }))}
					</text>
				{/if}

				<!-- 5. 今日の縦点線 -->
				{#if geo.todayX !== null}
					<line x1={geo.todayX} y1={geo.topY} x2={geo.todayX} y2={geo.baseY} class="stroke-accent" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="2 3" />
				{/if}

				<!-- 6. x 軸ラベル -->
				{#each geo.xticks as t, i (i)}
					<text x={t.x} y={hpx - 5} text-anchor={t.anchor} class="fill-text-dim text-[9px] lg:text-[10px]">{t.label}</text>
				{/each}

				<!-- 7. ホバー/タップ層（十字線＋ツールチップ） -->
				{#if hover}
					<line x1={hover.hx} y1={geo.topY} x2={hover.hx} y2={geo.baseY} class="stroke-accent" stroke-opacity="0.45" stroke-width="1" />
					{#if hover.has && hover.hy !== null}
						<circle cx={hover.hx} cy={hover.hy} r="4" class="fill-accent stroke-surface-solid" stroke-width="2" />
					{/if}
					<g>
						<rect x={hover.tx} y={hover.ty} width={hover.tw} height="18" rx="4" class="fill-surface-solid stroke-border-dim" stroke-width="1" />
						<text x={hover.tx + hover.tw / 2} y={hover.ty + 12} text-anchor="middle" class="fill-text-base text-[10px] lg:text-[11px]">
							{hover.label}
						</text>
					</g>
				{/if}

				<!-- 透明キャプチャ層（最前面・ポインタ取得）。ホバーは装飾的補助＝内容は svg の aria-label で担保 -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect
					x={geo.ML}
					y={geo.topY}
					width={geo.plotW}
					height={geo.baseY - geo.topY}
					fill="transparent"
					onpointermove={onMove}
					onpointerdown={onMove}
					onpointerleave={() => (hoverIdx = null)}
				/>
			</svg>
		{/if}
	</div>
</section>

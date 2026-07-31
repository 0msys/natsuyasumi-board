<script lang="ts">
	// ルビ対応テキスト入力（管理画面の「子どもが読むラベル」全入力で使う共通部品）。
	//   - 「漢字《よみ》」記法のライブプレビュー（《 が入っているときだけ）
	//   - 学年配当外漢字の非ブロッキング警告（保存は妨げない。サーバ validate と同基準）
	//   - 選択範囲に《よみ》を挿入する「ルビ」補助ボタン
	import { CircleAlert } from '@lucide/svelte';
	import Ruby from '$lib/summer/Ruby.svelte';
	import { ensureKanjiGrades, lintText } from './kanjiLint';

	let {
		value,
		placeholder = '',
		gradeLevel,
		nameExceptions = '',
		onInput
	}: {
		value: string;
		placeholder?: string;
		gradeLevel: number;
		nameExceptions?: string;
		onInput: (value: string) => void;
	} = $props();

	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let lintReady = $state(false);
	$effect(() => {
		let alive = true;
		void ensureKanjiGrades().then(() => {
			if (alive) lintReady = true;
		});
		return () => {
			alive = false;
		};
	});

	const hits = $derived(lintReady ? lintText(value ?? '', gradeLevel, nameExceptions) : []);
	const hasRuby = $derived((value ?? '').includes('《'));

	const KANJI_RE = /[㐀-鿿々〆〇ヶ]/;

	// 選択範囲の直後に《よみ》を挿入する。直前が漢字なら ｜ で基底の開始を明示して、
	// 前の漢字ランまでルビが伸びないようにする。
	function addRuby() {
		const el = inputEl;
		if (!el) return;
		const current = value ?? '';
		const start = el.selectionStart ?? 0;
		const end = el.selectionEnd ?? 0;
		if (start === end) {
			window.alert('よみをつけたい文字を、先に入力欄の中で選択してください');
			return;
		}
		const selected = current.slice(start, end);
		const reading = window.prompt(`「${selected}」のよみがな（ひらがな）`, '');
		if (!reading || !reading.trim()) return;
		const before = current.slice(0, start);
		const needsBar = before.length > 0 && KANJI_RE.test(before.slice(-1));
		onInput(before + (needsBar ? '｜' : '') + selected + '《' + reading.trim() + '》' + current.slice(end));
	}
</script>

<div class="flex min-w-0 flex-1 flex-col gap-1">
	<div class="flex items-center gap-1.5">
		<input
			bind:this={inputEl}
			type="text"
			value={value ?? ''}
			{placeholder}
			oninput={(e) => onInput(e.currentTarget.value)}
			class="min-w-0 flex-1 rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
		/>
		<button
			type="button"
			onclick={addRuby}
			title="選択した文字にルビ《よみ》をつける"
			class="shrink-0 rounded-md border border-border-dim px-2 py-1.5 text-xs text-text-dim hover:bg-surface2"
		>
			ルビ
		</button>
	</div>
	{#if hasRuby}
		<p class="rounded-md bg-surface2/60 px-2 py-1 text-sm text-text-base">
			<span class="mr-1 text-[10px] text-text-dim">みため:</span><Ruby text={value} />
		</p>
	{/if}
	{#each hits as hit (hit.char)}
		<p class="flex items-start gap-1 text-xs leading-relaxed text-warn">
			<CircleAlert size={13} class="mt-0.5 shrink-0" />
			<span>
				「{hit.char}」はまだ習っていない漢字です{hit.grade != null
					? `（${hit.grade}年生で習います）`
					: '（小学校では習いません）'}。ひらがなで書くのがおすすめです（ルビ《》をつけて漢字のまま見せることもできます）。
			</span>
		</p>
	{/each}
</div>

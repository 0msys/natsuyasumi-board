<script lang="ts">
	// 初回ウィザード（1画面ずつのステップ式）:
	// ①名前・よみがな ②学年 ③期間（start/end/始業式） ④テンプレート → 作成。
	// year は period.start の西暦から自動導出する（入力させない）。
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, ArrowRight, Check, CircleQuestionMark, TriangleAlert } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { errorDetail } from '$lib/api/apiError';
	import { GRADES } from '$lib/admin/docTypes';
	import PinGate from '$lib/admin/PinGate.svelte';
	import AdminDisabledNotice from '$lib/admin/AdminDisabledNotice.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let step = $state(1);
	let child = $state('');
	let childKana = $state('');
	let grade = $state('');
	let start = $state('');
	let end = $state('');
	let firstDay = $state('');
	let template = $state<'standard' | 'empty'>('standard');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const year = $derived(/^\d{4}-/.test(start) ? Number(start.slice(0, 4)) : null);
	const step1Ok = $derived(child.trim().length > 0);
	const step2Ok = $derived(grade !== '');
	const datesFilled = $derived(!!start && !!end && !!firstDay);
	const step3Ok = $derived(datesFilled && start < end && end < firstDay);

	// 何か打ってあるか（離脱ガードの引き金）。テンプレートは既定値があるので数えない——
	// ステップ4はステップ1〜3を埋めないと出ないので、そこだけ触った状態は起こらない。
	const hasInput = $derived(
		child.trim() !== '' ||
			childKana.trim() !== '' ||
			grade !== '' ||
			!!start ||
			!!end ||
			!!firstDay
	);

	// 作成が済んだ（＝下の goto で自分から出ていく）。入力欄は埋まったままなので、これが
	// 無いと成功した親に「保存していない変更があります」を出してしまう。
	let created = false;

	// 未入力のうちは黙って通す。ウィザードの入力は $state に持つだけなので、確認が無いと
	// ヘッダーの「一覧へ」やブラウザの戻るで、打った名前・学年・日づけが手がかりも無く消える。
	// 定義がゼロの初回はこの画面へ直行する＝はじめて触る親が最初に見る画面で起きる（issue #35）。
	// エディタ側（admin/[child]/+page.svelte）と作りも文言もそろえる。素通しの例外は要らない:
	// ステップ移動は URL を変えないので、ここへ来る遷移はすべて画面からの離脱になる。
	beforeNavigate((nav) => {
		if (created || !hasInput) return;
		if (nav.type === 'leave') {
			nav.cancel();
			return;
		}
		if (!confirm('保存していない変更があります。ページを離れると変更は失われます。よろしいですか？')) {
			nav.cancel();
		}
	});

	async function create() {
		if (!step1Ok || !step2Ok || !step3Ok || year == null || busy) return;
		busy = true;
		error = null;
		// 作成した名前を1回だけ確定させ、遷移先にも同じものを使う（await をまたいで
		// 入力を読み直すと、作った子と別のページへ飛びうる。いまは名前欄がステップ1に
		// あって送信中は描画されないので到達しないが、読み直す形を残さない）。
		const name = child.trim();
		try {
			await api.adminCreateDefinition({
				child: name,
				child_kana: childKana.trim() || name,
				grade,
				year,
				period: { start, end, first_day_of_school: firstDay },
				template
			});
			created = true; // ここから先の遷移は自分で起こすもの＝離脱ガードに聞かせない
			await goto(resolve('/admin/[child]', { child: encodeURIComponent(name) }));
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>あたらしくつくる | なつやすみボード</title></svelte:head>

<div class="mx-auto max-w-xl p-3 lg:p-6">
	<header class="mb-4 flex items-center justify-between">
		<h1 class="text-lg font-bold text-text-base lg:text-xl">あたらしくつくる</h1>
		<!-- 定義がゼロの初回はここへ直行するので、この画面のマニュアル入口は
		     アイコンだけにせず文字も出す（はじめて触る親が最初に見る画面）。
		     ただし別タブで開く: 離脱ガードが入ったので入力は消えないが、同じタブだと
		     「保存していない変更があります」の確認が挟まり、読むか直すかの二択になる。
		     手が止まってマニュアルを開く親ほど、そこまでの入力を持っている
		     （エディタのマニュアル入口が別タブなのも同じ理由）。 -->
		<div class="flex items-center gap-3">
			<a
				href={resolve('/manual')}
				target="_blank"
				rel="noopener"
				aria-label="つかいかた（別のタブでひらきます）"
				title="つかいかた（別のタブでひらきます）"
				class="flex items-center gap-1 text-sm text-text-dim hover:text-text-base"
			>
				<CircleQuestionMark size={16} />つかいかた
			</a>
			<a
				href={resolve('/admin')}
				class="flex items-center gap-1 text-sm text-text-dim hover:text-text-base"
			>
				<ArrowLeft size={16} />一覧へ
			</a>
		</div>
	</header>

	{#if !data.session}
		<div class="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
			サーバーにつながりませんでした。すこししてからひらきなおしてください。
		</div>
	{:else if data.session.admin_disabled}
		<AdminDisabledNotice />
	{:else if data.session.pin_required && !data.session.authenticated}
		<PinGate onSuccess={() => invalidateAll()} />
	{:else}
		<p class="mb-3 text-xs text-text-dim">ステップ {step} / 4</p>

		<div class="flex flex-col gap-4 rounded-lg bg-surface p-4 lg:p-5">
			{#if step === 1}
				<h2 class="text-base font-bold text-text-base">名前とよみがな</h2>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-text-dim">名前</span>
					<input
						type="text"
						bind:value={child}
						placeholder="画面の切りかえや記録の名前になります"
						class="rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-text-dim">よみがな（任意）</span>
					<input
						type="text"
						bind:value={childKana}
						placeholder="ひらがなで（画面のよびかけ・読み上げに使います）"
						class="rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
					/>
				</label>
			{:else if step === 2}
				<h2 class="text-base font-bold text-text-base">学年</h2>
				<p class="text-xs text-text-dim">
					学年で「表示できる漢字のはんい」（ラベル入力のルビ警告）が決まります。
				</p>
				<div class="flex flex-wrap gap-1.5">
					{#each GRADES as g (g)}
						<button
							type="button"
							aria-pressed={grade === g}
							onclick={() => (grade = g)}
							class="rounded-md border px-4 py-2 text-sm {grade === g
								? 'border-accent bg-accent font-bold text-white'
								: 'border-border-dim bg-surface2 text-text-dim'}"
						>
							{g}
						</button>
					{/each}
				</div>
			{:else if step === 3}
				<h2 class="text-base font-bold text-text-base">期間</h2>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-text-dim">なつやすみの初日</span>
					<input
						type="date"
						bind:value={start}
						class="rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-text-dim">なつやすみの最終日</span>
					<input
						type="date"
						bind:value={end}
						class="rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-text-dim">始業式の日</span>
					<input
						type="date"
						bind:value={firstDay}
						class="rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
					/>
				</label>
				{#if datesFilled && !step3Ok}
					<p class="text-sm text-danger">初日 → 最終日 → 始業式 の順にしてください。</p>
				{/if}
				<p class="text-xs text-text-dim">
					年（西暦）は初日から自動で決まります{#if year != null}: {year}年{/if}。
				</p>
			{:else}
				<h2 class="text-base font-bold text-text-base">テンプレート</h2>
				<button
					type="button"
					aria-pressed={template === 'standard'}
					onclick={() => (template = 'standard')}
					class="rounded-lg border p-3 text-left {template === 'standard'
						? 'border-accent bg-accent/10'
						: 'border-border-dim bg-surface2/60'}"
				>
					<p class="text-sm font-bold text-text-base">標準ではじめる（おすすめ）</p>
					<p class="mt-0.5 text-xs text-text-dim">
						はみがき×3・生活習慣・宿題の代表例・ごほうびランク入り。あとから自由に直せます。
					</p>
				</button>
				<button
					type="button"
					aria-pressed={template === 'empty'}
					onclick={() => (template = 'empty')}
					class="rounded-lg border p-3 text-left {template === 'empty'
						? 'border-accent bg-accent/10'
						: 'border-border-dim bg-surface2/60'}"
				>
					<p class="text-sm font-bold text-text-base">からっぽではじめる</p>
					<p class="mt-0.5 text-xs text-text-dim">項目なしの最小構成。ぜんぶ自分で組み立てます。</p>
				</button>
				{#if error}
					<p class="flex items-start gap-1.5 text-sm text-danger">
						<TriangleAlert size={16} class="mt-0.5 shrink-0" />{error}
					</p>
				{/if}
			{/if}

			<div class="flex items-center justify-between">
				{#if step > 1}
					<button
						type="button"
						onclick={() => (step -= 1)}
						class="flex items-center gap-1 rounded-lg bg-surface2 px-4 py-2 text-sm font-bold text-text-dim"
					>
						<ArrowLeft size={16} />もどる
					</button>
				{:else}
					<span></span>
				{/if}
				{#if step < 4}
					<button
						type="button"
						disabled={(step === 1 && !step1Ok) || (step === 2 && !step2Ok) || (step === 3 && !step3Ok)}
						onclick={() => (step += 1)}
						class="flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
					>
						つぎへ<ArrowRight size={16} />
					</button>
				{:else}
					<button
						type="button"
						disabled={busy}
						onclick={create}
						class="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
					>
						<Check size={16} />{busy ? 'つくっています…' : 'この内容でつくる'}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

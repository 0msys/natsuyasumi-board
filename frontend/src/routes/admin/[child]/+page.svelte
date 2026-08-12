<script lang="ts">
	// セクションエディタ本体（単一ルート＋ ?section= クエリのタブ10枚）。
	// ドラフト（AdminDraft）は load 結果から直接初期化し（SSR 対応）、各セクションが
	// doc を直接ミューテート＋markDirty。dirty のとき粘着フッターの「ほぞんする」で
	// validate → save（エラーは IssueList＋タブバッジに出す）。
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ArrowLeft, CircleQuestionMark, RefreshCw, Save, TriangleAlert } from '@lucide/svelte';
	import { api } from '$lib/api';
	import { errorDetail } from '$lib/api/apiError';
	import { AdminDraft } from '$lib/admin/draft.svelte';
	import { gradeLevelOf } from '$lib/admin/docTypes';
	import {
		SECTIONS,
		isSameEditTarget,
		sectionForPath,
		sectionHref,
		type SectionId
	} from '$lib/admin/sectionDefs';
	import IssueList from '$lib/admin/IssueList.svelte';
	import PinGate from '$lib/admin/PinGate.svelte';
	import AdminDisabledNotice from '$lib/admin/AdminDisabledNotice.svelte';
	import AwaySection from '$lib/admin/sections/AwaySection.svelte';
	import BasicSection from '$lib/admin/sections/BasicSection.svelte';
	import ChallengesSection from '$lib/admin/sections/ChallengesSection.svelte';
	import ChoiceSection from '$lib/admin/sections/ChoiceSection.svelte';
	import DailyHomeworkSection from '$lib/admin/sections/DailyHomeworkSection.svelte';
	import HabitsSection from '$lib/admin/sections/HabitsSection.svelte';
	import OneShotSection from '$lib/admin/sections/OneShotSection.svelte';
	import RewardsSection from '$lib/admin/sections/RewardsSection.svelte';
	import SchoolStartSection from '$lib/admin/sections/SchoolStartSection.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const draft = new AdminDraft();
	// SSR でも本文を出すため load 結果から直接初期化する（$effect は SSR で走らない）
	// svelte-ignore state_referenced_locally
	if (data.entry) draft.initFrom(data.entry);
	// 別の子ども・別の年への遷移（同一ルートのコンポーネント再利用）だけ読み直す。
	// 編集中の invalidate では draft を上書きしない（同じ子の同じ年なら何もしない）。
	$effect(() => {
		if (data.entry && (data.entry.child !== draft.child || data.entry.year !== draft.year))
			draft.initFrom(data.entry);
	});

	const section = $derived.by(() => {
		const raw = page.url.searchParams.get('section');
		return SECTIONS.some((s) => s.id === raw) ? (raw as SectionId) : 'basic';
	});

	const gradeLevel = $derived(gradeLevelOf(draft.doc?.grade));
	const nameExceptions = $derived(draft.doc?.child ?? '');

	// 記録件数（項目削除の影響警告用）。ページ表示ごとに1回だけ取る（ブラウザのみ）
	let usage = $state<Record<string, number>>({});
	let usageLoadedFor = '';
	$effect(() => {
		const child = data.entry?.child;
		if (!child || usageLoadedFor === child) return;
		usageLoadedFor = child;
		api
			.adminUsage(child)
			.then((r) => (usage = r.usage))
			.catch(() => {});
	});

	// 開いた時点でも一度検証する（保存はしない）。検証は save() の中からしか走っていなかった
	// ので、「からっぽ」で作って編集画面を眺めているだけの親には、直す先を指す警告が1つも
	// 届かなかった（issue #34）。dirty は触らないので「保存していない変更があります」には
	// ならず、「ほぞんする」も disabled のまま。失敗は黙って捨てる——読むためだけの検証で、
	// 画面を止める理由にはならない（つながらないなら保存のときに同じ経路で分かる）。
	let validatedFor = '';
	$effect(() => {
		const key = `${draft.child}:${draft.year}`;
		if (!draft.doc || validatedFor === key) return;
		validatedFor = key;
		void draft.validate().catch(() => {});
	});

	// dirty での離脱ガード。タブ切替（同じ年の中の ?section= 遷移）だけ素通しする。
	// 年の切替は同じ URL パスでもドラフトを作り直す＝素通しすると編集内容が黙って消える。
	beforeNavigate((nav) => {
		if (!draft.dirty) return;
		if (isSameEditTarget(nav.from?.url, nav.to?.url, draft.year)) return;
		if (nav.type === 'leave') {
			nav.cancel();
			return;
		}
		if (!confirm('保存していない変更があります。ページを離れると変更は失われます。よろしいですか？')) {
			nav.cancel();
		}
	});

	function countBySection(issues: { path: string }[]): Partial<Record<SectionId, number>> {
		const counts: Partial<Record<SectionId, number>> = {};
		for (const issue of issues) {
			const sec = sectionForPath(issue.path);
			if (sec) counts[sec] = (counts[sec] ?? 0) + 1;
		}
		return counts;
	}
	const errCounts = $derived(countBySection(draft.errors));
	const warnCounts = $derived(countBySection(draft.warnings));

	const showFooter = $derived(
		draft.dirty ||
			draft.conflict ||
			draft.saveError !== null ||
			draft.errors.length > 0 ||
			draft.warnings.length > 0 ||
			draft.savedAt !== null
	);

	async function reloadFromServer() {
		if (draft.dirty && !confirm('読み直すと、この画面の変更は失われます。よろしいですか？')) return;
		try {
			await draft.load(data.child);
		} catch (e) {
			draft.saveError = errorDetail(e);
		}
	}

	// その年ぶんだけを消す（まちがえて作った来年ぶんの取り消し）。年が1つのときは出さない
	// ＝「子どもごと消す」は一覧ページの削除に集約する（同じ操作の入口を2つ作らない）。
	async function deleteThisYear() {
		if (draft.years.length < 2) return;
		if (!confirm(`「${data.child}」の${draft.year}年ぶんの設定をけしますか？（記録は消えません）`))
			return;
		try {
			await api.adminDeleteDefinition(data.child, draft.year);
			const rest = draft.years.filter((y) => y !== draft.year);
			const href = resolve('/admin/[child]', { child: encodeURIComponent(data.child) });
			await goto(`${href}?year=${rest[rest.length - 1]}`, { invalidateAll: true });
		} catch (e) {
			draft.saveError = errorDetail(e);
		}
	}
</script>

<svelte:head><title>{data.child} のせってい | なつやすみボード</title></svelte:head>

<div class="mx-auto max-w-3xl p-3 pb-48 lg:p-6 lg:pb-48">
	<header class="mb-4 flex items-center gap-3">
		<a
			href={resolve('/admin')}
			class="flex shrink-0 items-center gap-1 text-sm text-text-dim hover:text-text-base"
		>
			<ArrowLeft size={16} />一覧
		</a>
		<h1 class="min-w-0 truncate text-lg font-bold text-text-base lg:text-xl">
			「{data.child}」のせってい
		</h1>
		{#if draft.years.length < 2 && draft.year}
			<span class="shrink-0 text-sm text-text-dim">{draft.year}年</span>
		{/if}
		<!-- ml-auto で右端に寄せ、余りは truncate する <h1> に吸わせる
		     （年の span が出ている・いないの両方で右端に着く）。
		     別タブで開くのは admin/new と同じ理由＝未保存の入力を抱えた画面だから。
		     ここは離脱ガードがあるので消えはしないが、同じタブだと「離れると変更は
		     失われます」の確認が出て、読むか直すかの二択になる。 -->
		<a
			href={resolve('/manual')}
			target="_blank"
			rel="noopener"
			aria-label="つかいかた（別のタブでひらきます）"
			title="つかいかた（別のタブでひらきます）"
			class="ml-auto flex shrink-0 items-center gap-1 text-sm text-text-dim hover:text-text-base"
		>
			<CircleQuestionMark size={16} /><span class="hidden sm:inline">つかいかた</span>
		</a>
	</header>

	{#if draft.years.length > 1}
		<!-- 年タブ: 年をまたいで持っている子だけ出す（1年しか無い家庭の画面は変えない） -->
		<nav class="mb-4 flex flex-wrap items-center gap-1.5">
			{#each draft.years as y (y)}
				<a
					href={`${resolve('/admin/[child]', {
						child: encodeURIComponent(data.child)
					})}?year=${y}&section=${section}`}
					class="rounded-full px-3 py-1.5 text-xs font-bold lg:text-sm {y === draft.year
						? 'bg-accent text-white'
						: 'bg-surface2 text-text-dim'}"
				>
					{y}年
				</a>
			{/each}
			<button
				type="button"
				onclick={deleteThisYear}
				class="ml-auto rounded-md px-2 py-1.5 text-xs text-danger/70 hover:bg-surface2"
			>
				この年をけす
			</button>
		</nav>
	{/if}

	{#if !data.session}
		<div class="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
			サーバーにつながりませんでした。すこししてからひらきなおしてください。
		</div>
	{:else if data.session.admin_disabled}
		<AdminDisabledNotice />
	{:else if data.session.pin_required && !data.session.authenticated}
		<PinGate onSuccess={() => invalidateAll()} />
	{:else if data.loadError}
		<div class="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
			{data.loadError}
		</div>
	{:else if draft.doc}
		<nav class="mb-4 flex flex-wrap gap-1.5">
			{#each SECTIONS as s (s.id)}
				<a
					href={sectionHref(s.id, draft.year)}
					data-sveltekit-noscroll
					class="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold lg:text-sm {section ===
					s.id
						? 'bg-accent text-white'
						: 'bg-surface2 text-text-dim'}"
				>
					{s.label}
					{#if errCounts[s.id]}
						<span class="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
							{errCounts[s.id]}
						</span>
					{:else if warnCounts[s.id]}
						<span class="rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-bold text-white">
							{warnCounts[s.id]}
						</span>
					{/if}
				</a>
			{/each}
		</nav>

		{#if section === 'basic'}
			<BasicSection {draft} />
		{:else if section === 'habits'}
			<HabitsSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else if section === 'daily'}
			<DailyHomeworkSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else if section === 'challenges'}
			<ChallengesSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else if section === 'rewards'}
			<RewardsSection {draft} {gradeLevel} {nameExceptions} />
		{:else if section === 'oneshot'}
			<OneShotSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else if section === 'choice'}
			<ChoiceSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else if section === 'schoolstart'}
			<SchoolStartSection {draft} {gradeLevel} {nameExceptions} {usage} />
		{:else}
			<AwaySection {draft} {gradeLevel} {nameExceptions} />
		{/if}
	{/if}
</div>

{#if showFooter && draft.doc}
	<div class="fixed inset-x-0 bottom-0 z-50 border-t border-border-dim bg-surface-solid px-3 py-3 shadow-2xl">
		<div class="mx-auto flex max-w-3xl flex-col gap-2">
			{#if draft.conflict}
				<div class="flex flex-wrap items-center gap-2 text-sm text-danger">
					<TriangleAlert size={16} class="shrink-0" />
					ほかの画面で変更されています。読み直してから保存してください。
					<button
						type="button"
						onclick={reloadFromServer}
						class="flex items-center gap-1 rounded-md border border-danger/50 px-2 py-1 text-xs font-bold text-danger hover:bg-danger/10"
					>
						<RefreshCw size={13} />読み直す
					</button>
				</div>
			{/if}
			{#if draft.saveError}
				<p class="flex items-start gap-1.5 text-sm text-danger">
					<TriangleAlert size={16} class="mt-0.5 shrink-0" />{draft.saveError}
				</p>
			{/if}
			<IssueList errors={draft.errors} warnings={draft.warnings} year={draft.year} />
			<div class="flex items-center justify-between gap-3">
				<span class="text-xs text-text-dim">
					{#if draft.dirty}
						保存していない変更があります
					{:else if draft.savedAt !== null}
						保存しました
					{/if}
				</span>
				<button
					type="button"
					disabled={draft.saving || !draft.dirty}
					onclick={() => void draft.save()}
					class="flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
				>
					<Save size={16} />{draft.saving ? 'ほぞん中…' : 'ほぞんする'}
				</button>
			</div>
		</div>
	</div>
{/if}

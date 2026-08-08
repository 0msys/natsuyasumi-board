<script lang="ts">
	// 管理画面トップ: 子ども一覧＋あたらしくつくる＋インポート／エクスポート・名前の変更・削除。
	// 一覧の再読込は invalidateAll（load を再実行）で行う。
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowLeft,
		CalendarPlus,
		Download,
		Pencil,
		Plus,
		Trash2,
		TriangleAlert,
		Upload
	} from '@lucide/svelte';
	import { api } from '$lib/api';
	import type { AdminDocument, ChildInfo } from '$lib/api';
	import Modal from '$lib/Modal.svelte';
	import { errorDetail } from '$lib/api/apiError';
	import { downloadJson } from '$lib/admin/download';
	import BackupCard from '$lib/backup/BackupCard.svelte';
	import { looksLikeBackup } from '$lib/backup/format';
	import PinGate from '$lib/admin/PinGate.svelte';
	import AdminDisabledNotice from '$lib/admin/AdminDisabledNotice.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let actionError = $state<string | null>(null);
	let importBusy = $state(false);
	let fileEl = $state<HTMLInputElement | undefined>(undefined);
	let deleting = $state<ChildInfo | null>(null);
	let deleteName = $state('');
	let deleteBusy = $state(false);
	let nextYearBusy = $state<string | null>(null);
	let exportBusy = $state<string | null>(null);

	// 設定を JSON で書き出す（兄弟への流用・他のご家庭との共有・バックアップ）。
	async function exportDoc(c: ChildInfo) {
		exportBusy = c.child;
		actionError = null;
		try {
			const { filename, doc } = await api.adminExportDoc(c.child);
			downloadJson(filename, doc);
		} catch (e) {
			actionError = errorDetail(e);
		} finally {
			exportBusy = null;
		}
	}

	// 来年ぶんの設定を、いちばん新しい年からコピーして作る。
	// 項目はそのまま・日付と学年は1年ぶん進み、記録は引きつがれない（サーバ側で決めている）。
	async function createNextYear(c: ChildInfo) {
		const from = Math.max(...c.years);
		if (
			!confirm(
				`「${c.child}」の${from + 1}年ぶんの設定を、${from}年ぶんからコピーして作ります。\n` +
					'項目はそのまま、きかん・始業式・学年は1年あとになります。\n' +
					'チェックの記録は引きつがれません（おでかけの予定は空になります）。'
			)
		)
			return;
		nextYearBusy = c.child;
		actionError = null;
		try {
			const entry = await api.adminCreateNextYear(c.child);
			await goto(`${resolve('/admin/[child]', { child: encodeURIComponent(c.child) })}?year=${entry.year}`, {
				invalidateAll: true
			});
		} catch (e) {
			actionError = errorDetail(e);
		} finally {
			nextYearBusy = null;
		}
	}

	const fmtMD = (iso: string) => {
		const [, m, d] = iso.split('-');
		return `${Number(m)}/${Number(d)}`;
	};

	async function rename(c: ChildInfo) {
		const next = window.prompt(`「${c.child}」の新しい名前（記録もいっしょに引きつがれます）`, c.child);
		if (next == null) return;
		const trimmed = next.trim();
		if (!trimmed || trimmed === c.child) return;
		actionError = null;
		try {
			await api.adminRenameChild(c.child, trimmed);
			await invalidateAll();
		} catch (e) {
			actionError = errorDetail(e);
		}
	}

	async function confirmDelete() {
		if (!deleting || deleteName.trim() !== deleting.child || deleteBusy) return;
		deleteBusy = true;
		actionError = null;
		try {
			await api.adminDeleteDefinition(deleting.child);
			deleting = null;
			deleteName = '';
			await invalidateAll();
		} catch (e) {
			actionError = errorDetail(e);
		} finally {
			deleteBusy = false;
		}
	}

	async function onImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // 同じファイルの再選択でも change が発火するように
		if (!file) return;
		actionError = null;
		let doc: unknown;
		try {
			doc = JSON.parse(await file.text());
		} catch {
			actionError = 'JSON として読み取れませんでした';
			return;
		}
		if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
			actionError = '定義の JSON ファイルではないようです';
			return;
		}
		importBusy = true;
		try {
			// 取り込み口を2つ覚えてもらうのは酷なので、中身を見て振り分ける。
			// まるごとバックアップは全部を置きかえるので、必ず確認を挟む。
			if (looksLikeBackup(doc)) {
				if (
					!confirm(
						'これはまるごとバックアップのファイルです。\n' +
							'いまこの端末に入っている記録と設定は、すべて置きかわります。\n\n' +
							'続けますか？'
					)
				) {
					importBusy = false;
					return;
				}
				await api.backupImportAll(doc);
			} else {
				await api.adminImportDefinition(doc as AdminDocument);
			}
			await invalidateAll();
		} catch (err) {
			actionError = errorDetail(err);
		} finally {
			importBusy = false;
		}
	}
</script>

<svelte:head><title>せってい | なつやすみボード</title></svelte:head>

<div class="mx-auto max-w-3xl p-3 lg:p-6">
	<header class="mb-4 flex items-center justify-between">
		<h1 class="text-lg font-bold text-text-base lg:text-xl">せってい</h1>
		<a
			href={resolve('/')}
			class="flex items-center gap-1 text-sm text-text-dim hover:text-text-base"
		>
			<ArrowLeft size={16} />子どもページへ
		</a>
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
		{#if actionError}
			<div
				class="mb-3 flex items-center gap-2 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger"
			>
				<TriangleAlert size={16} class="shrink-0" />{actionError}
			</div>
		{/if}
		{#if data.loadError}
			<div class="mb-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
				{data.loadError}
			</div>
		{/if}

		<!-- ブラウザ保存の版だけ出る（記録がこの端末の中にしか無いので） -->
		<BackupCard onImported={() => invalidateAll()} />

		<div class="flex flex-col gap-3">
			{#each data.definitions as c (c.child)}
				<div
					class="flex flex-col gap-3 rounded-lg bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<p class="text-base font-bold text-text-base">{c.child}</p>
							{#if c.child_kana && c.child_kana !== c.child}
								<span class="text-xs text-text-dim">（{c.child_kana}）</span>
							{/if}
							{#if !c.valid}
								<span class="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white">
									定義が壊れています
								</span>
							{/if}
						</div>
						{#if c.valid && c.period}
							<p class="mt-0.5 text-xs text-text-dim">
								{c.grade} ・ {fmtMD(c.period.start)}〜{fmtMD(c.period.end)}（始業式 {fmtMD(
									c.period.first_day_of_school
								)}）・ {c.year}年
							</p>
							{#if c.years.length > 1}
								<p class="mt-0.5 text-xs text-text-dim">
									ほかの年: {c.years.filter((y) => y !== c.year).join('年・')}年
								</p>
							{/if}
						{:else if c.error}
							<p class="mt-0.5 text-xs text-danger">{c.error}</p>
						{/if}
					</div>
					<div class="flex shrink-0 flex-wrap items-center gap-1.5">
						<a
							href={resolve('/admin/[child]', { child: encodeURIComponent(c.child) })}
							class="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
						>
							ひらく
						</a>
						{#if c.valid}
							<button
								type="button"
								disabled={nextYearBusy === c.child}
								onclick={() => createNextYear(c)}
								title={`来年（${Math.max(...c.years) + 1}年）ぶんをつくる`}
								aria-label={`来年（${Math.max(...c.years) + 1}年）ぶんをつくる`}
								class="rounded-md p-2 text-text-dim hover:bg-surface2 disabled:opacity-50"
							>
								<CalendarPlus size={16} />
							</button>
						{/if}
						<button
							type="button"
							disabled={exportBusy === c.child}
							onclick={() => exportDoc(c)}
							title="エクスポート（JSON）"
							aria-label="エクスポート（JSON）"
							class="rounded-md p-2 text-text-dim hover:bg-surface2 disabled:opacity-50"
						>
							<Download size={16} />
						</button>
						<button
							type="button"
							onclick={() => rename(c)}
							title="名前の変更"
							aria-label="名前の変更"
							class="rounded-md p-2 text-text-dim hover:bg-surface2"
						>
							<Pencil size={16} />
						</button>
						<button
							type="button"
							onclick={() => {
								deleting = c;
								deleteName = '';
							}}
							title="削除"
							aria-label="削除"
							class="rounded-md p-2 text-danger/70 hover:bg-surface2"
						>
							<Trash2 size={16} />
						</button>
					</div>
				</div>
			{/each}
			{#if data.definitions.length === 0 && !data.loadError}
				<p class="text-sm text-text-dim">
					まだ定義がありません。「あたらしくつくる」からはじめてください。
				</p>
			{/if}
		</div>

		<div class="mt-4 flex flex-wrap gap-2">
			<a
				href={resolve('/admin/new')}
				class="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
			>
				<Plus size={16} />あたらしくつくる
			</a>
			<button
				type="button"
				disabled={importBusy}
				onclick={() => fileEl?.click()}
				class="flex items-center gap-1.5 rounded-lg border border-border-dim px-4 py-2 text-sm font-bold text-text-dim hover:bg-surface2 disabled:opacity-50"
			>
				<Upload size={16} />{importBusy ? 'とりこみ中…' : 'JSON をインポート'}
			</button>
			<input
				bind:this={fileEl}
				type="file"
				accept=".json,application/json"
				class="hidden"
				onchange={onImportFile}
			/>
		</div>
	{/if}
</div>

{#if deleting}
	<Modal
		onClose={() => (deleting = null)}
		maxWidthPx={480}
		gutterRem={1}
		maxHeightVh={80}
		ariaLabel="定義の削除"
	>
		<h3 class="mb-2 flex items-center gap-2 text-base font-bold text-text-base">
			<TriangleAlert size={18} class="shrink-0 text-danger" />「{deleting.child}」の定義をけしますか？
		</h3>
		<p class="mb-3 text-sm leading-relaxed text-text-dim">
			チェックの記録は消えませんが、定義（項目やごほうびの設定）が消えて、子どもページに出なくなります。まちがい防止のため、名前をそのまま入力してください。
		</p>
		<input
			type="text"
			bind:value={deleteName}
			placeholder={deleting.child}
			class="mb-3 w-full rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
		/>
		<div class="flex justify-end gap-2">
			<button
				type="button"
				onclick={() => (deleting = null)}
				class="rounded-lg bg-surface2 px-4 py-2 text-sm font-bold text-text-dim"
			>
				やめる
			</button>
			<button
				type="button"
				disabled={deleteName.trim() !== deleting.child || deleteBusy}
				onclick={confirmDelete}
				class="rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
			>
				{deleteBusy ? 'けしています…' : 'けす'}
			</button>
		</div>
	</Modal>
{/if}

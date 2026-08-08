<script lang="ts">
	// バックアップの催促と、ホーム画面への追加の案内。
	//
	// lite（ブラウザ保存）だけの話なので、api が supported:false を返す版では何も出さない。
	// 出す理由: iOS Safari は「7日間ひらかなかったサイト」の保存データを消すことがある。
	// ホーム画面に追加したものは対象外になるので、まずそれを勧め、そのうえで
	// 「消えても戻せる」ようバックアップを促す。
	import { Download, HousePlus, Upload, X } from '@lucide/svelte';
	import { api, type BackupStatus } from '$lib/api';
	import { downloadJson } from '$lib/admin/download';
	import { errorDetail } from '$lib/api/apiError';

	let { onImported }: { onImported?: () => void } = $props();

	let status = $state<BackupStatus | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let fileEl = $state<HTMLInputElement | undefined>(undefined);

	// この端末が「ホーム画面から開いたアプリ」として動いているか。
	// standalone なら iOS の7日間削除の対象外なので、追加の案内は出さない。
	const installed =
		typeof window !== 'undefined' &&
		(window.matchMedia?.('(display-mode: standalone)').matches ||
			// iOS Safari は display-mode を返さない時期が長かったので独自プロパティも見る
			(navigator as unknown as { standalone?: boolean }).standalone === true);

	async function refresh() {
		try {
			status = await api.backupStatus();
		} catch {
			status = null; // 取れないなら何も出さない（催促は「あると助かる」もの）
		}
	}
	$effect(() => {
		void refresh();
	});

	const daysSince = $derived(
		status?.last_backup_at
			? Math.floor((Date.now() / 1000 - status.last_backup_at) / 86400)
			: null
	);
	// 未バックアップ＝赤、7日超または50件超＝黄、それ以下＝ふつう
	const level = $derived(
		!status?.last_backup_at
			? 'danger'
			: (daysSince ?? 0) > 7 || status.changes_since_backup > 50
				? 'warn'
				: 'ok'
	);

	async function exportAll() {
		busy = true;
		error = null;
		notice = null;
		try {
			const { filename, payload } = await api.backupExportAll();
			downloadJson(filename, payload);
			notice = `${filename} をほぞんしました。`;
			await refresh();
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}

	async function importAll(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // 同じファイルを選び直せるように毎回空へ戻す
		if (!file) return;
		if (
			!confirm(
				'バックアップで まるごと入れかえます。\n' +
					'いまこの端末に入っている記録と設定は、すべて置きかわります。\n\n' +
					'続けますか？'
			)
		)
			return;
		busy = true;
		error = null;
		notice = null;
		try {
			await api.backupImportAll(JSON.parse(await file.text()));
			notice = 'バックアップから もどしました。';
			await refresh();
			onImported?.();
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if status?.supported}
	<div class="mb-4 flex flex-col gap-3">
		<!-- 保存そのものが効いていないときは、この案内より先に読むべきものがある
		     （警告は admin/+layout.svelte が画面の上に出している） -->
		{#if !installed && !status.home_hint_dismissed && !status.storage_ephemeral}
			<div class="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
				<HousePlus size={18} class="mt-0.5 shrink-0 text-accent" />
				<div class="flex-1 text-sm text-text-base">
					<p class="font-bold">ホーム画面に追加してください</p>
					<p class="mt-0.5 text-xs text-text-dim">
						ブラウザのままだと、しばらく開かなかったときに記録が消えることがあります。
						共有ボタン（iPhone・iPad）またはメニュー（Android・PC）から「ホーム画面に追加」を
						選んでおくと、その心配がなくなります。
					</p>
				</div>
				<button
					type="button"
					aria-label="この案内を閉じる"
					onclick={async () => {
						await api.backupDismissHomeHint();
						await refresh();
					}}
					class="shrink-0 rounded-md p-1 text-text-dim hover:bg-surface2"
				>
					<X size={16} />
				</button>
			</div>
		{/if}

		<div
			class="flex flex-wrap items-center gap-2 rounded-lg border p-3 {level === 'danger'
				? 'border-danger/50 bg-danger/5'
				: level === 'warn'
					? 'border-warn/50 bg-warn/5'
					: 'border-border-dim'}"
		>
			<div class="flex-1 text-sm text-text-base">
				{#if !status.last_backup_at}
					<p class="font-bold">まだバックアップしていません</p>
					<p class="mt-0.5 text-xs text-text-dim">
						記録はこの端末のブラウザの中にだけあります。ファイルに出しておくと、
						消えても・別の端末に移りたくなっても戻せます。
					</p>
				{:else}
					<p>
						さいごのバックアップ: {daysSince === 0 ? 'きょう' : `${daysSince}日前`}
						{#if status.changes_since_backup > 0}
							<span class="text-text-dim">（そのあと {status.changes_since_backup}件）</span>
						{/if}
					</p>
				{/if}
			</div>
			<button
				type="button"
				disabled={busy}
				onclick={exportAll}
				class="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
			>
				<Download size={16} />バックアップする
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => fileEl?.click()}
				class="flex items-center gap-1.5 rounded-lg border border-border-dim px-3 py-2 text-sm font-bold text-text-base disabled:opacity-50"
			>
				<Upload size={16} />もどす
			</button>
			<input
				bind:this={fileEl}
				type="file"
				accept="application/json,.json"
				onchange={importAll}
				class="hidden"
			/>
		</div>

		{#if notice}<p class="text-xs text-text-dim">{notice}</p>{/if}
		{#if error}<p class="text-xs text-danger">{error}</p>{/if}
	</div>
{/if}

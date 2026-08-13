<script lang="ts">
	// バックアップの催促と、ホーム画面への追加の案内。
	//
	// lite（ブラウザ保存）だけの話なので、api が supported:false を返す版では何も出さない。
	// 出す理由: iOS Safari は「7日間ひらかなかったサイト」の保存データを消すことがある。
	// ホーム画面に追加したものは対象外になるので、まずそれを勧め、そのうえで
	// 「消えても戻せる」ようバックアップを促す。
	import { Download, HousePlus, Upload, X } from '@lucide/svelte';
	import { api, type BackupStatus, type BackupTicket } from '$lib/api';
	import { downloadJson, type DownloadHandle } from '$lib/admin/download';
	import { errorDetail } from '$lib/api/apiError';
	import { backupLevel, daysSinceBackup } from './level';
	import { sameBackupFile } from './ticket';

	let { onImported }: { onImported?: () => void } = $props();

	let status = $state<BackupStatus | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let fileEl = $state<HTMLInputElement | undefined>(undefined);
	// 押し直せるリンクのための blob。**問いかけを出すかどうかはこれで決めない**。
	//
	// 問いかけそのものは保存側（status.pending_backup）にある。ここに持たせていたころは、
	// 設定画面を離れた瞬間——iPhone なら共有シートやプレビューから「もどる」だけでも——
	// 問いかけごと消えて、ファイルは端末にあるのに「まだバックアップしていません」が
	// 二度と引っ込まなかった。blob は画面を離れれば本当に無くなるものなので、こちらに残す。
	let handle = $state<{ ticket: BackupTicket; download: DownloadHandle } | null>(null);
	// 走っている書き出しが「まだ自分の番か」を見るための世代。描画には使わない（$state にしない）。
	let handleGen = 0;

	function dropHandle() {
		handleGen++; // 往復の途中のものは、戻ってきても出さない
		handle?.download.release();
		handle = null;
	}
	// 画面を離れるときに解放する（抱えているのは記録まるごとの写し）。
	$effect(() => () => dropHandle());

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

	/** 保存の状態を読み直す。
	 *
	 *  この画面の別の口（管理画面トップの「JSON をインポート」）から復元したあとに呼んでもらう。
	 *  復元は保存側で問いかけを落とすが、こちらは読み直さないかぎり古い問いかけを出したままになる
	 *  （invalidateAll() はページの load をやり直すだけで、このカードの $effect は走らない）。 */
	export async function reloadStatus() {
		await refresh();
	}

	// 日数もしきい値の判定も $lib/backup/level に置いてある（子どもページの歯車バッジと
	// 同じものを使う。ここに書き写すと、また片方だけずれる）。
	const daysSince = $derived(status ? daysSinceBackup(status) : null);
	const level = $derived(status ? backupLevel(status) : 'ok');

	// まだ答えていない問いかけ。保存側が持っているので、開き直しても残っている。
	const question = $derived(status?.pending_backup ?? null);
	// 押し直せるリンクを出してよいのは、いま手元にある blob が、問いかけの指すファイルと
	// 同じときだけ。開き直したあと（blob は消えている）や、別のタブが後から書き出したあとに
	// 出すと、文中のファイル名とリンクの中身が食い違う。
	const canRelink = $derived(!!(handle && question && sameBackupFile(handle.ticket, question.ticket)));

	// 書き出してブラウザに渡すところまで。「バックアップした」ことにはまだしない
	// ——渡したファイルが端末に残ったかは、こちらからは分からない。
	async function exportAll() {
		busy = true;
		error = null;
		notice = null;
		dropHandle();
		const gen = handleGen;
		try {
			const { filename, payload, ticket } = await api.backupExportAll();
			// 待っているあいだに画面を離れた（＝ティアダウンが走り終わった）なら、渡す先も
			// 聞く相手ももういない。ここで作ると、release() を呼べる者が誰も居ない blob URL
			// ——記録まるごとの写し——がタブを閉じるまで残る。
			if (gen !== handleGen) return;
			// ここに await を挟まないこと。押した操作の続きとみなされるうちに渡す
			// （間が空くと、こちらが仕込んだクリックが黙って落とされることがある）。
			handle = { ticket, download: downloadJson(filename, payload) };
			// 渡せたと分かってから覚える。書き出しの api の中で覚えると、上の「画面を離れた」や
			// Blob の組み立てが落ちた回にも問いかけだけが残る——手元に無いファイルに
			// 「ほぞんできた」と答えられて、催促が1週間消える。
			await api.backupNotePending({ ticket, filename });
			await refresh();
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}

	// 親が「ほぞんできた」と答えたときだけ、催促の基準を進める。
	async function confirmSaved() {
		if (!question) return;
		// ファイル名は問いかけ（保存側）から取る。開き直したあとは手元の blob が無いので、
		// そちらを見ていると文言からファイル名が消える。
		const { ticket, filename } = question;
		busy = true;
		error = null;
		try {
			const { recorded } = await api.backupMarkSaved(ticket);
			if (recorded) {
				notice = `${filename} をほぞんしました。`;
			} else {
				// 待っているあいだに復元した／別のタブがもっと新しいものを書き出した、
				// あるいは保存が作り直された。どちらも「このファイルがいまの記録の
				// どこまでか」が言えない状態で、進めると手元に無い分まで「済み」になる。
				error =
					'このファイルは いまの記録と合わなくなっていたので、日づけは変えませんでした。もういちど「バックアップする」をおしてください。';
			}
			dropHandle();
			await refresh();
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}

	// 出てこなかった・取り消した。何も記録しないので、催促はそのまま残る。
	async function giveUpSaved() {
		if (!question) return;
		// どのファイルについて「できていない」と答えたのかを渡す。別のタブが後から書き出して
		// いたら、そちらの問いかけは残す（そのファイルは端末にあるので、確かめる口が要る）。
		const { ticket } = question;
		busy = true;
		notice = null;
		error = null;
		try {
			await api.backupDismissPending(ticket);
			dropHandle();
			await refresh();
			error =
				'ほぞんできていないので、さいごのバックアップの日づけは そのままにしました。もういちど「バックアップする」をおしてください。';
		} catch (e) {
			error = errorDetail(e);
		} finally {
			busy = false;
		}
	}

	// この画面の別の口（管理画面トップの「JSON をインポート」）からまるごと復元するとき、
	// 置きかえる**前**に呼んでもらう。抱えている blob（記録まるごとの写し）を解放し、
	// 前の操作の言葉を消すだけ。問いかけそのものを落とすのは復元側の仕事で、
	// 置きかえたあとに reloadStatus() を呼んでもらえば画面から消える。
	export function resetForRestore() {
		dropHandle();
		notice = null;
		error = null;
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
		// 抱えている blob は、もう指す先が無い（置きかえたあとの記録とは別物）。
		// 問いかけのほうは置きかえが落とすので、下の refresh() で画面からも消える。
		dropHandle();
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
		<!-- 押しただけでは「バックアップした」ことにしない。
		     ファイルが端末に残ったかはブラウザが教えてくれないので、ここで親に聞く。
		     「ほぞんできた」を押すまで、さいごのバックアップの日づけは動かない。

		     いちばん上に出す。iPhone で共有シートやプレビューから戻ってきた親が最初に見るのは
		     画面の上端で、ボタンの下だとスクロールしないと見えない——それで問いかけに気づけず、
		     ファイルは取れているのに「まだバックアップしていません」が消えない、という報告が出た。 -->
		{#if question}
			<div class="flex flex-wrap items-center gap-2 rounded-lg border border-warn/50 bg-warn/5 p-3">
				<div class="flex-1 text-sm text-text-base">
					<p class="font-bold">ファイルは ほぞんできましたか？</p>
					<p class="mt-0.5 text-xs text-text-dim">
						{question.filename} を書き出しました。端末に入っているのを確かめてください。
						{#if canRelink}
							出てこないときは<a
								href={handle?.download.url}
								download={question.filename}
								class="underline">こちらからほぞん</a
							>できます。
						{:else}
							この画面をひらき直したので、押し直せるリンクは消えています。ファイルが
							見あたらなければ「もういちど書き出す」をおしてください。
						{/if}
					</p>
				</div>
				<button
					type="button"
					disabled={busy}
					onclick={confirmSaved}
					class="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
				>
					ほぞんできた
				</button>
				{#if !canRelink}
					<!-- ラベルに「バックアップする」を含めないこと（e2e の get_by_role は部分一致で、
					     含めると当たり先が2つになる）。 -->
					<button
						type="button"
						disabled={busy}
						onclick={exportAll}
						class="rounded-lg border border-border-dim px-3 py-2 text-sm font-bold text-text-base disabled:opacity-50"
					>
						もういちど書き出す
					</button>
				{/if}
				<button
					type="button"
					disabled={busy}
					onclick={giveUpSaved}
					class="rounded-lg border border-border-dim px-3 py-2 text-sm font-bold text-text-base disabled:opacity-50"
				>
					できていない
				</button>
			</div>
		{/if}

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

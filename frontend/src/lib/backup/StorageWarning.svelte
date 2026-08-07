<script lang="ts">
	// 「この端末では記録が保存されない」ことを伝える帯。
	//
	// 管理画面のどのページにも出す（admin/+layout.svelte が置いている）。バックアップの
	// カードといっしょに1ページだけへ置くと、届かない人が出る——定義がゼロのとき、
	// 入口はウィザードへ直行し、登録が終わると編集画面へ移るので、一覧を一度も
	// 通らずに夏休みぶんの設定を入れ終えられてしまう。そのままタブを閉じると全部消える。
	import { TriangleAlert } from '@lucide/svelte';
	import { api } from '$lib/api';

	let ephemeral = $state(false);

	$effect(() => {
		void api
			.backupStatus()
			.then((s) => (ephemeral = s.supported && s.storage_ephemeral))
			.catch(() => (ephemeral = false));
	});
</script>

{#if ephemeral}
	<div
		role="alert"
		class="mx-auto mb-3 flex max-w-3xl items-start gap-2 rounded-lg border-2 border-danger bg-danger/10 p-3"
	>
		<TriangleAlert size={20} class="mt-0.5 shrink-0 text-danger" />
		<div class="text-sm text-text-base">
			<p class="font-bold text-danger">この画面では記録が保存されません</p>
			<p class="mt-0.5 text-xs text-text-dim">
				タブを閉じるか、ひらきなおすと、入れた設定も記録もすべて消えます。
				プライベートブラウズ（シークレットモード）で開いていないか確かめてください。
				ふつうのウィンドウで開きなおすと保存できるようになります。
			</p>
		</div>
	</div>
{/if}

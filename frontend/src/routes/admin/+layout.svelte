<script lang="ts">
	// 管理画面ぜんぶの上に、保存が効いていないときの警告を出すためだけの層。
	//
	// 親が設定を入れるのは一覧・ウィザード・編集画面の3つで、しかも初回は一覧を
	// 通らない（定義がゼロだと入口がウィザードへ直行する）。どこか1ページに置くと
	// 必ず取りこぼすので、まとめてここに置く。
	import StorageWarning from '$lib/backup/StorageWarning.svelte';

	let { children } = $props();
</script>

<div class="p-3 pb-0 lg:p-6 lg:pb-0">
	<StorageWarning />
</div>
{@render children()}

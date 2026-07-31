<script lang="ts">
	// 管理 API が無効（ADMIN_PIN も ADMIN_NO_AUTH も未設定＝フェイルクローズ既定）のときの説明。
	// この状態は「PIN を入れれば入れる」わけではないので PinGate を出してはいけない。
	// 出さないと、管理画面が「認証済みのふり」で描画され、保存や一覧取得だけが 403 で失敗する
	// （初回インストールでは、ウィザードを最後まで入力させてから 403 になる）。
	import { ShieldAlert } from '@lucide/svelte';
</script>

<div class="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-text-base">
	<h2 class="mb-2 flex items-center gap-2 font-bold text-amber-600">
		<ShieldAlert size={18} />管理画面は無効になっています
	</h2>
	<p class="mb-3">
		管理 API の保護方針が選ばれていないため、設定の読み書きはすべて拒否されます。
		サーバーを次のどちらかで起動しなおしてください。
	</p>
	<ul class="mb-3 flex flex-col gap-2">
		<li>
			<span class="font-semibold">PIN で保護する（推奨）:</span>
			<code class="rounded bg-surface2 px-1.5 py-0.5">ADMIN_PIN=1234 docker compose up --build</code>
		</li>
		<li>
			<span class="font-semibold">PIN なしで使う:</span>
			<code class="rounded bg-surface2 px-1.5 py-0.5">ADMIN_NO_AUTH=1 docker compose up --build</code>
			<span class="text-text-dim">（家庭内 LAN 専用。インターネットには公開しないでください）</span>
		</li>
	</ul>
	<p class="text-text-dim">子どもの画面（記録・チェック）はこの設定に関係なく使えます。</p>
</div>

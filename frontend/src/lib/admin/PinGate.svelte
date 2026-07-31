<script lang="ts">
	// 管理画面の PIN ゲート（adminSession が pin_required && !authenticated のとき表示）。
	// 成功したら onSuccess（呼び出し側が invalidateAll などで読み直す）。
	import { Lock } from '@lucide/svelte';
	import { api } from '$lib/api';

	let { onSuccess }: { onSuccess: () => void } = $props();

	let pin = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!pin || busy) return;
		busy = true;
		error = null;
		try {
			await api.adminLogin(pin);
			onSuccess();
		} catch {
			error = 'PIN がちがいます';
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto mt-8 max-w-sm rounded-lg bg-surface p-6">
	<h2 class="mb-2 flex items-center gap-2 text-base font-bold text-text-base">
		<Lock size={18} class="text-accent" />PIN を入力してください
	</h2>
	<p class="mb-3 text-xs text-text-dim">せってい画面をひらくには、保護者用の PIN が必要です。</p>
	<form onsubmit={submit} class="flex items-center gap-2">
		<input
			type="password"
			inputmode="numeric"
			autocomplete="off"
			bind:value={pin}
			placeholder="PIN"
			class="min-w-0 flex-1 rounded-md border border-border-dim bg-surface px-3 py-2 text-text-base"
		/>
		<button
			type="submit"
			disabled={busy || !pin}
			class="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
		>
			ひらく
		</button>
	</form>
	{#if error}<p class="mt-2 text-sm text-danger">{error}</p>{/if}
</div>

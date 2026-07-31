<script lang="ts">
	// 記録つき項目の削除確認モーダル（usage > 0 のときだけ出す）。
	// 記録自体は消えないが、分母が減って過去の日の点数が上がって見えることを伝える。
	import { TriangleAlert } from '@lucide/svelte';
	import Modal from '$lib/Modal.svelte';
	import Ruby from '$lib/summer/Ruby.svelte';

	let {
		label,
		count,
		onConfirm,
		onClose
	}: { label: string; count: number; onConfirm: () => void; onClose: () => void } = $props();
</script>

<Modal {onClose} maxWidthPx={480} gutterRem={1} maxHeightVh={80} ariaLabel="項目をけす確認">
	<h3 class="mb-2 flex items-center gap-2 text-base font-bold text-text-base">
		<TriangleAlert size={18} class="shrink-0 text-warn" />
		<span>「<Ruby text={label} />」をけしますか？</span>
	</h3>
	<p class="mb-4 text-sm leading-relaxed text-text-dim">
		この項目には {count}件の記録があります。記録は消えませんが、項目をけすと過去の日の点数が上がって見えます。
	</p>
	<div class="flex justify-end gap-2">
		<button
			type="button"
			onclick={onClose}
			class="rounded-lg bg-surface2 px-4 py-2 text-sm font-bold text-text-dim"
		>
			やめる
		</button>
		<button
			type="button"
			onclick={onConfirm}
			class="rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white"
		>
			けす
		</button>
	</div>
</Modal>

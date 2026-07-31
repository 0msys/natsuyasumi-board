<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { unlockTtsAudio } from '$lib/ttsAudio';

	let { children } = $props();

	onMount(() => {
		// OS のダーク設定に追従（app.html の先行適用を引き継ぎ、変更イベントで切り替え）
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const apply = () => document.documentElement.classList.toggle('dark', mq.matches);
		apply();
		mq.addEventListener('change', apply);
		// iOS Safari の音声解放の安全網（最初のタップで共有オーディオ要素を解放しておく）
		const unlock = () => unlockTtsAudio();
		window.addEventListener('pointerdown', unlock, { once: true });
		return () => {
			mq.removeEventListener('change', apply);
			window.removeEventListener('pointerdown', unlock);
		};
	});
</script>

{@render children()}

<script module lang="ts">
	// モーダルの a11y 挙動を全 Modal インスタンスで共有するスタック台帳。
	// 複数モーダル（TaskModal → 入れ子 DocDetailModal 等）が同時に開いても、
	//   - Escape は最前面（stack 先頭）のみ閉じる
	//   - scroll-lock は参照カウントで最後の1枚が閉じるまで解除しない
	//   - focus-trap は最前面パネル内で Tab/Shift+Tab をループさせる
	// を成立させる。keydown は capture 段で拾い stopPropagation して
	// VoiceOverlay / ChatFab の window keydown と Escape が二重発火しないようにする。
	type StackEntry = { panel: HTMLElement; requestClose: () => void };
	const stack: StackEntry[] = [];
	let savedOverflow = '';

	const FOCUSABLE =
		'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
	function focusables(panel: HTMLElement): HTMLElement[] {
		return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			(el) => el.offsetParent !== null
		);
	}

	function onKeydown(e: KeyboardEvent) {
		const top = stack.at(-1);
		if (!top) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			top.requestClose();
			return;
		}
		if (e.key === 'Tab') {
			const f = focusables(top.panel);
			if (f.length === 0) {
				e.preventDefault();
				top.panel.focus();
				return;
			}
			const first = f[0];
			const last = f[f.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (!top.panel.contains(active)) {
				e.preventDefault();
				(e.shiftKey ? last : first).focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			} else if (e.shiftKey && active === first) {
				e.preventDefault();
				last.focus();
			}
		}
	}

	function pushModal(entry: StackEntry) {
		if (stack.length === 0) {
			savedOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			document.addEventListener('keydown', onKeydown, true);
		}
		stack.push(entry);
	}
	function popModal(entry: StackEntry) {
		const i = stack.indexOf(entry);
		if (i >= 0) stack.splice(i, 1);
		if (stack.length === 0) {
			document.body.style.overflow = savedOverflow;
			document.removeEventListener('keydown', onKeydown, true);
		}
	}
</script>

<script lang="ts">
	// ダイアログ系モーダルの共有シェル（EventDetail / DocDetail / Insurance / AddEvent が使用）。
	// 現状の4モーダルで byte-identical だった外殻を集約する:
	//   - backdrop（背景クリックで閉じる）
	//   - body 直下への portal（祖先の will-change:transform が position:fixed の基準を奪うため）
	//   - タップ位置起点の top クランプ（本文の高さが変わっても ResizeObserver で追従）
	// パネル内の header / 本文 / footer は各モーダルが children で渡す（見た目は現状のまま）。
	// サイズ差異は prop で保持: 480/560/720px・gutter 1/2rem・80/85/90vh。
	// 注: z-100 / z-101 はリテラルのクラス文字列のまま持つ（prop 補間すると Tailwind の
	// content スキャナが出力せず z が消える）。
	import { tick, type Snippet } from 'svelte';

	type Props = {
		anchorY?: number | null;
		onClose: () => void;
		maxWidthPx: number;
		gutterRem: number;
		maxHeightVh: number;
		ariaLabel?: string;
		children: Snippet;
	};

	let { anchorY = null, onClose, maxWidthPx, gutterRem, maxHeightVh, ariaLabel, children }: Props =
		$props();

	let panelEl: HTMLDivElement | null = $state(null);
	let backdropEl: HTMLDivElement | null = $state(null);
	let topPx = $state<number | null>(null);

	$effect(() => {
		if (!panelEl || !backdropEl) return;
		document.body.appendChild(backdropEl);
		document.body.appendChild(panelEl);
		return () => {
			backdropEl?.remove();
			panelEl?.remove();
		};
	});

	// a11y: このモーダルをスタック台帳へ登録（Escape/scroll-lock/focus-trap）。
	// 開いた時に最初のフォーカス可能要素へ移し、閉じたらトリガー要素へ復帰する。
	// onClose は requestClose の closure 内で遅延読みするため、identity 変化で再登録しない
	// （追跡する $state は panelEl のみ＝マウント時に1回登録・アンマウント時に1回解除）。
	$effect(() => {
		const prev = document.activeElement as HTMLElement | null;
		if (!panelEl) return;
		const entry = { panel: panelEl, requestClose: () => onClose() };
		pushModal(entry);
		tick().then(() => {
			if (!panelEl) return;
			const f = focusables(panelEl);
			(f[0] ?? panelEl).focus();
		});
		return () => {
			popModal(entry);
			if (prev?.isConnected) prev.focus();
		};
	});

	// タップ位置を起点にパネルの top を決める. 画面外にはみ出さないようクランプ.
	// top（位置）だけを変えるので高さは変わらず、ResizeObserver のループは起きない。
	function reposition() {
		if (anchorY == null || !panelEl) {
			topPx = null;
			return;
		}
		const margin = 8;
		const vh = window.innerHeight;
		const h = panelEl.offsetHeight;
		const desired = anchorY - 24;
		const maxTop = Math.max(margin, vh - h - margin);
		topPx = Math.min(Math.max(margin, desired), maxTop);
	}

	// 各モーダルが持っていた content-specific な再計算トリガー（void editing / void body 等）を
	// ResizeObserver で共通化＝本文の非同期ロードや編集モード展開で高さが変わっても追従する。
	$effect(() => {
		void anchorY;
		if (!panelEl) return;
		const ro = new ResizeObserver(() => reposition());
		ro.observe(panelEl);
		tick().then(reposition);
		return () => ro.disconnect();
	});
</script>

<div bind:this={backdropEl} class="fixed inset-0 bg-black/50 z-100" onclick={onClose} role="presentation"></div>
<div
	bind:this={panelEl}
	class="fixed left-1/2 overflow-y-auto scroll-elegant bg-surface-solid rounded-xl p-5 z-101 shadow-2xl"
	style:width={`min(${maxWidthPx}px, calc(100vw - ${gutterRem}rem))`}
	style:max-height={`${maxHeightVh}vh`}
	style:top={topPx != null ? `${topPx}px` : '50%'}
	style:transform={topPx != null ? 'translateX(-50%)' : 'translate(-50%, -50%)'}
	role="dialog"
	aria-modal="true"
	aria-label={ariaLabel}
	tabindex="-1"
>
	{@render children()}
</div>

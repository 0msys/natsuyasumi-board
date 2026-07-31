<script lang="ts">
	// 「漢字《よみ》」記法のラベルをルビ付きで描画する（夏休みタブ専用）。
	// セグメントを直接描画し {@html} を使わない＝Svelte の自動エスケープで XSS 安全。
	//
	// 出力全体を1つの <span> で包む。包まないと、flex コンテナ（`flex items-center gap-2` の
	// 見出しなど）の中で <ruby> と地の文が別々の flex アイテムになり、
	//   - ルビの分だけ背の高い <ruby> と地の文がそれぞれ独立に中央揃えされて基線がずれる
	//   - アイテムの境目に gap が入って「今日」と「のチェック」の間が空く
	// という崩れかたをする。span で包めば1アイテムになり、中はふつうの行内整形（ベースライン揃え）に戻る。
	import { parseRuby } from './ruby';

	let { text }: { text: string | null | undefined } = $props();
	const segments = $derived(parseRuby(text ?? ''));
</script>

<!-- prettier-ignore -->
<span>{#each segments as seg}{#if seg.kind === 'ruby'}<ruby>{seg.base}<rt>{seg.rt}</rt></ruby>{:else}{seg.text}{/if}{/each}</span>


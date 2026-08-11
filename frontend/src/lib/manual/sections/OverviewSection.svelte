<script lang="ts">
	import { Star, Trophy, TriangleAlert } from '@lucide/svelte';
	import EditionNote from '../EditionNote.svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import { SCREEN } from '../labels';
	import type { Edition } from '../edition';

	let { edition }: { edition: Edition } = $props();
</script>

<ManualSection id="overview">
	<p>
		「なつやすみボード」は、お子さんが夏休みの宿題と毎日の習慣を<strong>自分でチェックする</strong
		>ための画面です。親は最初に「何をチェックするか」を決めるだけで、あとは点数もごほうびも自動で計算されます。
	</p>

	<h3>1日100点のしくみ</h3>
	<p>1日の点数は100点満点で、次の2つに分かれています。</p>
	<ul>
		<li><strong>{SCREEN.sectionHabits}（50点）</strong> — 早起き、歯みがきなど、毎日の習慣</li>
		<li><strong>{SCREEN.sectionDaily}（50点）</strong> — ドリル、日記など、毎日やる宿題</li>
	</ul>
	<p>
		それぞれ「できた数 ÷ その日の項目数」で計算します。たとえば生活習慣が4つあって3つできていれば、50
		×
		3÷4＝38点です。どちらか片方だけ全部やっても100点にはなりません（そのため、両方に1つ以上の項目を入れてください）。
	</p>
	<p>
		100点になった日は<UiLabel><Star size={13} />{SCREEN.challengeTitle}</UiLabel
		>が開き、1つできるごとに +25点 が足されます。つまり100点を<strong>超える</strong>日もあります。
	</p>

	<h3>やる気のしかけ</h3>
	<ul>
		<li>100点になった瞬間に<strong>花火</strong>が上がります（「{SCREEN.celebrationTitle}」）</li>
		<li>
			つみあげた点数で<UiLabel><Trophy size={13} />{SCREEN.rewardTitle}</UiLabel
			>が上がっていきます。ランクの名前・必要な点・ごほうびの品は親が自由に決められます
		</li>
		<li>連続で満点だった日数が記録に残ります</li>
	</ul>

	<h3>記録はどこにありますか</h3>
	<EditionNote only="lite" {edition}>
		<p>
			記録は<strong>その端末のブラウザの中だけ</strong>にあり、どこにも送信されません。サーバーはありません。
		</p>
		<p>
			そのため、<strong>タブレットとスマホでは別々の記録になります</strong
			>。お子さんが使う端末を1つ決めて、そこで記録してください。
		</p>
		<p>
			端末の中だけにあるということは、端末を替えたり、ブラウザのデータを消したりすると記録も消えるということです。<a
				href="#data"
				class="text-accent underline">データの保存とバックアップ</a
			>を必ずお読みください。
		</p>
	</EditionNote>
	<EditionNote only="docker" {edition}>
		<p>記録はおうちのサーバーの中にあります。</p>
		<p>
			そのため、<strong>同じWi-Fiにつながっていれば何台からでも同じ記録が見られます</strong
			>。リビングのタブレットでお子さんがチェックし、親のスマホで進みぐあいを確認する、という使い方ができます。
		</p>
	</EditionNote>

	<h3 class="flex items-center gap-1">
		<TriangleAlert size={16} class="text-attn" />画面の文字について
	</h3>
	<p>
		お子さんの画面は、<strong>設定した学年に合わせて漢字がひらがなになります</strong
		>。たとえば小1なら「きょうのチェック」、小5なら「今日のチェック」と出ます。
	</p>
	<p>
		このマニュアルは親向けなので漢字のまま書いています。実際の画面と少しちがって見えることがありますが、同じ場所のことです。
	</p>
</ManualSection>

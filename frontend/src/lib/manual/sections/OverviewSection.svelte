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
		「なつやすみボード」は、お子さんが夏休みの宿題と毎日の習慣を自分でチェックするための画面です。親は「何をチェックするか」と「どこまでいくとどんなごほうびか」を先に決めておきます。日々の点数とランクの計算は、アプリが行います。
	</p>

	<h3>1日100点のしくみ</h3>
	<p>1日の点数は100点満点で、次の2つに分かれています。</p>
	<ul>
		<li>{SCREEN.sectionHabits}（50点） … 早起き、歯みがきなど、毎日の習慣</li>
		<li>{SCREEN.sectionDaily}（50点） … ドリル、日記など、毎日やる宿題</li>
	</ul>
	<p>
		それぞれ「できた数 ÷ その日の項目数」で計算します。たとえば「{SCREEN.sectionHabits}」の項目が4つあって3つできていれば、50
		× 3 ÷ 4 = 37.5
		を四捨五入して38点です。どちらか片方だけ全部やっても100点にはなりません。両方に1つ以上の項目を入れてください。
	</p>
	<p>
		「しゅくだい」を全部やった日は<UiLabel><Star size={13} />{SCREEN.challengeTitle}</UiLabel
		>が開きます。1つできるごとに +25点 が足されるのは、その日が100点になったときだけです。1日の点数が100点を超える日もあります。
	</p>

	<h3>やる気のしかけ</h3>
	<ul>
		<li>100点になった瞬間に花火が上がります（「{SCREEN.celebrationTitle}」）</li>
		<li>
			つみあげた点数で<UiLabel><Trophy size={13} />{SCREEN.rewardTitle}</UiLabel
			>が上がっていきます。ランクの名前・必要な点・ごほうびの品は親が自由に決められます
		</li>
		<li>連続で満点だった日数が記録に残ります</li>
	</ul>

	<h3>記録の置き場所</h3>
	<EditionNote only="lite" {edition}>
		<p>記録はその端末のブラウザの中だけにあり、どこにも送信されません。サーバーはありません。</p>
		<p>
			そのため、タブレットとスマホでは別々の記録になります。お子さんが使う端末を1つ決めて、そこで記録してください。
		</p>
		<p>
			<strong>端末を替えたり、ブラウザのデータを消したりすると、記録も消えます。</strong><a
				href="#data"
				class="text-accent underline">データの保存とバックアップ</a
			>を必ずお読みください。
		</p>
	</EditionNote>
	<EditionNote only="docker" {edition}>
		<p>記録はおうちのサーバーの中にあります。</p>
		<p>
			そのため、同じWi-Fiにつながっていれば何台からでも同じ記録が見られます。リビングのタブレットでお子さんがチェックし、親のスマホで進みぐあいを確認する、という使い方ができます。
		</p>
	</EditionNote>

	<h3 class="flex items-center gap-1">
		<TriangleAlert size={16} class="text-attn" />画面の文字について
	</h3>
	<p>
		お子さんの画面は、設定した学年に合わせて漢字がひらがなになります。たとえば小1なら「きょうのチェック」、小5なら「今日のチェック」と出ます。
	</p>
	<p>
		このマニュアルは親向けなので、漢字のまま書いています。実際の画面はひらがなが多くなりますが、指しているものは同じです。
	</p>
</ManualSection>

<script lang="ts">
	import { ArrowLeft, ArrowRight, Check, HousePlus, Lock, TriangleAlert } from '@lucide/svelte';
	import EditionNote from '../EditionNote.svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import type { Edition } from '../edition';

	let { edition }: { edition: Edition } = $props();
</script>

<ManualSection id="setup">
	<p>
		はじめて開いたときは、子どもの登録画面（「あたらしくつくる」）が最初に出ます。ここを終わらせると、お子さんの画面が使えるようになります。
	</p>

	<EditionNote only="lite" {edition}>
		<p><strong>登録より先に、この端末を「ホーム画面に追加」してください。</strong></p>
		<ul>
			<li>iPhone・iPad … 画面下（または上）の共有ボタン → 「ホーム画面に追加」</li>
			<li>Android・パソコン … ブラウザのメニュー → 「アプリをインストール」「ホーム画面に追加」</li>
		</ul>
		<p>
			ふつうのタブのままだと、しばらく開かなかったときにブラウザが保存データを消してしまうことがあります（iPhone
			の Safari は7日間ひらかなかったサイトのデータを消します）。<UiLabel
				><HousePlus size={13} />ホーム画面に追加</UiLabel
			>しておくと、その対象から外れます。
		</p>
		<p>画面の中にも同じ案内が出ます。追加が済んだら、その案内は閉じてかまいません。</p>
	</EditionNote>

	<h3>ステップ1 — 名前とよみがな</h3>
	<ul>
		<li>名前 … 必須です。記録を保存するときの目印になります</li>
		<li>
			よみがな … 省略できます。入れると、お子さんの画面での呼びかけに使われます。省略したときは名前をそのまま使います
		</li>
	</ul>

	<h3>ステップ2 — 学年</h3>
	<p>
		小1から小6のどれかを選びます。学年は「どの漢字をひらがなにするか」と「ほめコメントの言いまわし」に使われます。あとから変えられます。
	</p>

	<h3>ステップ3 — 期間の日づけ</h3>
	<p>夏休みの初日・最終日・始業式の3つを入れます。</p>
	<ul>
		<li>
			「初日 → 最終日 → 始業式」の順に入れてください。順番が逆のときや、同じ日のときは先へ進めません
		</li>
		<li>「何年ぶんの設定か」は初日の年から自動で決まります。入力する必要はありません</li>
	</ul>

	<h3>ステップ4 — テンプレート</h3>
	<ul>
		<li>
			標準 … 生活・毎日の宿題・スペシャルチャレンジ・ごほうびランクが入った状態で始めます。迷ったらこちらを選んでください。あとから自由に変えられます
		</li>
		<li>からっぽ … 項目が1つも無い状態から、自分で組み立てます</li>
	</ul>
	<p class="flex items-start gap-1">
		<TriangleAlert size={16} class="mt-0.5 shrink-0 text-attn" />
		<span
			>「からっぽ」を選んだときは、<strong
				>「せいかつ」と「しゅくだい」に、それぞれ1つ以上の項目を入れてください。</strong
			>両方とも空のままだと、お子さんの画面にチェックするものが無く、点数は 0点 / 100点
			のままです。スペシャルチャレンジも開きません。
		</span>
	</p>
	<p>
		注意が出るのは「どちらか片方だけが空」のときだけです。両方とも空のときは何も出ません。「からっぽ」で始めたら、まず両方に項目を足してください。
	</p>
	<p>
		<UiLabel><ArrowLeft size={13} />もどる</UiLabel> と
		<UiLabel>つぎへ<ArrowRight size={13} /></UiLabel>
		で行き来できます。もどっても入力した内容は消えません。最後に
		<UiLabel><Check size={13} />この内容でつくる</UiLabel> を押すと、その子の設定画面が開きます。
	</p>

	<h3>夏休みが始まる前に登録したとき</h3>
	<p>
		早めに登録しておくのはおすすめですが、<strong
			>夏休みの初日になるまで、お子さんの画面に今日のチェック欄は出ません。</strong
		>
	</p>
	<p>
		このとき画面には「夏休みのきかんが終わったよ」と出ます。これは「いまは夏休みの期間の外です」という意味で、まだ始まっていない時期にも出ます。初日になれば、チェック欄が出ます。
	</p>
	<p>
		そのあいだも、ごほうびランク・新学期のじゅんび・宿題のすすみぐあい・記録の表は先に見られます。日づけをまちがえていないかは、設定の「きほん」タブで確かめられます。
	</p>

	<EditionNote only="docker" {edition}>
		<p class="flex items-center gap-1">
			<Lock size={16} class="shrink-0" /><strong>PIN を聞かれたとき</strong>
		</p>
		<p>
			設定画面に鍵をかけている場合は、先に PIN
			の入力欄が出ます。決めた数字を入れてください。一度入れると、その端末では30日間は聞かれません。
		</p>
		<p>
			PIN はお子さんが設定をいじってしまうのを防ぐための簡単な鍵です。インターネットに公開してよいものではありません。
		</p>
	</EditionNote>

	<EditionNote only="lite" {edition}>
		<p class="flex items-center gap-1">
			<TriangleAlert size={16} class="shrink-0 text-danger" /><strong
				>赤い「記録が保存されません」の帯が出たとき</strong
			>
		</p>
		<p>
			プライベートブラウズ（シークレットモード）で開いていると出ます。この状態で入力しても、画面を閉じた時点で全部消えます。<strong
				>ふつうのタブで開き直してください。</strong
			>
		</p>
	</EditionNote>
</ManualSection>

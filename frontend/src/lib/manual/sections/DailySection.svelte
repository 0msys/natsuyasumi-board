<script lang="ts">
	import {
		Circle,
		CloudRain,
		Crown,
		Lock,
		Play,
		Settings,
		Sparkles,
		Square,
		Star,
		Timer,
		Tv,
		Volume2,
		X
	} from '@lucide/svelte';
	import EditionNote from '../EditionNote.svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import { SCREEN } from '../labels';
	import type { Edition } from '../edition';

	let { edition }: { edition: Edition } = $props();
</script>

<ManualSection id="daily">
	<p>お子さんが毎日ひらく画面です。夏休みの期間中だけチェック欄が出ます。</p>

	<h3>画面のいちばん上</h3>
	<ul>
		<li>名前のボタン … 2人以上を登録しているときだけ出ます。押すとその子の画面に変わります</li>
		<li>
			<Tv size={13} class="inline align-middle" />
			{SCREEN.timerTitle} … 今日テレビを見た時間。押すと操作画面が開きます（→
			<a href="#progress" class="text-accent underline">進みぐあいとごほうびを見る</a>）
		</li>
		<li>期間の表示 … 夏休みの初日〜最終日と始業式</li>
		<li>
			<Settings size={13} class="inline align-middle" /> 歯車 … 親用の設定画面へ移ります（→
			<a href="#admin" class="text-accent underline">設定を変える</a>）
		</li>
	</ul>
	<EditionNote only="lite" {edition}>
		<p>
			歯車に赤い点がつくのは、バックアップの合図です。押して設定画面をひらくと、理由と操作が出ます（→
			<a href="#data" class="text-accent underline">データの保存とバックアップ</a
			>）。お子さんの画面には催促の文字は出ません。
		</p>
	</EditionNote>

	<h3><Sparkles size={16} class="inline align-middle" /> {SCREEN.todayChecks}</h3>
	<p>
		その日の「{SCREEN.sectionHabits}」と「{SCREEN.sectionDaily}」が並びます。項目ごとに次のボタンを押します。
	</p>
	<ul>
		<li>
			<UiLabel><Circle size={13} />{SCREEN.checkDone}</UiLabel> … 点が入ります
		</li>
		<li>
			<UiLabel><X size={13} />{SCREEN.checkNotDone}</UiLabel> … 点は入りません
		</li>
		<li>
			<UiLabel><CloudRain size={13} />{SCREEN.checkCancelled}</UiLabel> …
			<strong>点は「{SCREEN.checkDone}」と同じように入ります</strong
			>。雨でプールが中止になった日など、本人のせいではない日のためのボタンです。この選択肢を出すかどうかは項目ごとに設定できます
		</li>
	</ul>
	<p>同じボタンをもう一度押すと、未記入にもどります。押しまちがえても大丈夫です。</p>
	<p>
		日づけは日本時間で切り替わります。画面は60秒ごとに日づけを見直すので、夜0時をまたいだ直後の1分ほどは前の日として記録されることがあります。
	</p>

	<h3>宿題のメモ欄</h3>
	<p>
		宿題にメモ欄を設定していると、「{SCREEN.checkDone}」にした日だけ入力できます。3種類あります。
	</p>
	<ul>
		<li>文字 … 読んだ本の題名など</li>
		<li>えらぶ … 用意した選択肢をボタンで1つ選びます。もう一度押すと外れます</li>
		<li>分と秒 … 分は0〜99、秒は0〜59まで</li>
	</ul>
	<p>空にして保存すると、そのメモは消えます。</p>

	<h3><Timer size={16} class="inline align-middle" /> {SCREEN.stopwatchLabel}</h3>
	<p>
		「分と秒」のメモ欄がある宿題には、ストップウォッチが出ます。<UiLabel
			><Play size={13} />{SCREEN.stopwatchStart}</UiLabel
		>
		で始めて <UiLabel><Square size={13} />{SCREEN.stopwatchStop}</UiLabel>
		で止めると、その宿題が自動で「{SCREEN.checkDone}」になり、かかった時間も書き込まれます。ピアノの練習時間などを子どもだけで記録できます。
	</p>

	{#if edition === 'docker'}
		<h3><Volume2 size={16} class="inline align-middle" /> {SCREEN.todoSpeechAsk}</h3>
		<p>
			VOICEVOX
			を動かしている場合だけ出るボタンです。押すと「今日まだやっていないこと」を文字で出し、同じ内容を声で読み上げます。
		</p>
		<p>
			まだ手をつけていない「{SCREEN.sectionHabits}」と毎日の宿題に加えて、締め切りが近づいた一回ものの宿題（夏休み終了の7日前から）と新学期の準備（期限の3日前から）も入ります。おでかけの日は、責める言い方になりません。
		</p>
	{:else}
		<h3>「{SCREEN.todoSpeechAsk}」ボタンについて</h3>
		<p>
			読み上げの機能はこの版にはありません（音声はサーバー側で作るしくみのため）。docker
			版では、まだやっていないことを声で教えてくれるボタンが出ます。
		</p>
	{/if}

	<h3>
		<Sparkles size={16} class="inline align-middle" />
		{SCREEN.commentTitle}（点数とコメント）
	</h3>
	<ul>
		<li>その日の点数と、{SCREEN.sectionHabits}・{SCREEN.sectionDaily}・チャレンジの内訳が出ます</li>
		<li>点数に合わせたほめ言葉が出ます。言いまわしは学年に合わせて変わります</li>
		<li>100点になった瞬間に花火が上がります（開き直したときは出ません）</li>
		<li>
			100点を超えると点数が虹色になり、その日の最高点に届くと<Crown
				size={13}
				class="inline align-middle"
			/> 王冠が付きます
		</li>
	</ul>
	<EditionNote only="docker" {edition}>
		<p>
			VOICEVOX を動かしていると <UiLabel><Volume2 size={13} />{SCREEN.listen}</UiLabel>
			が出て、コメントを声で読み上げます。ランクが上がったときは自動でも読み上げます。
		</p>
	</EditionNote>

	<h3><Star size={16} class="inline align-middle" /> {SCREEN.challengeTitle}</h3>
	<p>
		{SCREEN.challengeBonus}。ただし、<strong
			>その日の「{SCREEN.sectionDaily}」を全部やるまでは開きません</strong
		>（<Lock
			size={13}
			class="inline align-middle"
		/>「{SCREEN.challengeLocked}」と出ます）。「{SCREEN.sectionHabits}」は開く条件に入れていません。夜の歯みがきのように寝る前にしか終わらない項目があると、宿題を朝に終えても就寝直前まで押せなくなるためです。
	</p>
	<p>
		<strong>開くことと点が入ることは別です。</strong>点が足されるのは、その日の基本点（{SCREEN.sectionHabits}＋{SCREEN.sectionDaily}）が100点になった日だけ。「{SCREEN.sectionHabits}」に「やらなかった」や未記入が残ったまま1日が終わると、チャレンジの記録は残っても点にはなりません。チャレンジを○にしてあって点がまだ入らないあいだは、「{SCREEN.sectionHabits}も全部できたらもらえるよ」と、保留になっている点数を添えて出ます（○にした数だけ増えます）。まだ1つも○にしていないうちは、もらえる点がないので何も出ません。
	</p>
	<p>
		「まず今日やることを全部おわらせる → ごほうびに追加点をねらう」という順番は変わりません。あとから「{SCREEN.sectionHabits}」の記録を消して100点未満にもどすと、チャレンジの記録は残ったまま点だけ加算されなくなります。
	</p>

	<h3>画面の自動更新</h3>
	<p>お子さんの画面は60秒ごと、テレビタイマーは5秒ごとに、自動で読み直します。</p>
	<EditionNote only="docker" {edition}>
		<p>
			別の端末でつけた記録も、60秒以内にこの画面に出ます。お子さんがタブレットで100点にした瞬間、親のスマホでも花火が上がります。
		</p>
	</EditionNote>
	<EditionNote only="lite" {edition}>
		<p>
			読み直すのはその端末の中の記録だけです。ほかの端末でつけた記録がここに出ることはありません。
		</p>
	</EditionNote>
</ManualSection>

<script lang="ts">
	import {
		Backpack,
		BookMarked,
		Check,
		Minus,
		Play,
		Plus,
		Square,
		Trophy,
		Tv
	} from '@lucide/svelte';
	import EditionNote from '../EditionNote.svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import { SCREEN } from '../labels';
	import type { Edition } from '../edition';

	let { edition }: { edition: Edition } = $props();
</script>

<ManualSection id="progress">
	<h3><BookMarked size={16} class="inline align-middle" /> {SCREEN.homeworkTitle}</h3>
	<p>
		毎日やる宿題とは別に、「夏休み中に一度やればいい宿題」の進みぐあいがここに出ます。上には
		<strong>夏休みの何日目か</strong>と残り日数のバーが出るので、ペースの目安になります。
	</p>
	<ul>
		<li>
			<strong>いっかいもの（完了型）</strong> —
			<UiLabel><Check size={13} />できた</UiLabel> を押すと完了。もう一度押すと戻ります
		</li>
		<li>
			<strong>いっかいもの（冊数型）</strong> —
			<UiLabel><Minus size={13} /></UiLabel> と <UiLabel><Plus size={13} /></UiLabel>
			で0〜99まで数えます。決めた目標の数に届くと完了になります
		</li>
		<li>
			<strong>{SCREEN.homeworkOptional}</strong> — 先に
			<UiLabel>{SCREEN.decideDo}</UiLabel> / <UiLabel>{SCREEN.decideSkip}</UiLabel>
			を選ぶ宿題です。「{SCREEN.decideSkip}」にしている間は完了のボタンが押せなくなります
		</li>
		<li>
			<strong>えらぶ宿題</strong> —
			「工作・自由研究・料理から1つ以上」のように、グループの中から決めた数だけ選ぶ宿題です。必要な数を割ってしまう「{SCREEN.decideSkip}」は選べません
		</li>
		<li>
			<strong>{SCREEN.homeworkDoneDays}</strong> —
			毎日の宿題を今まで何日やったかの数え上げです。ここは表示だけで、記録は今日のチェックから行います
		</li>
	</ul>
	<p class="text-text-dim">
		注意: 「{SCREEN.decideSkip}」にしたままの宿題を、あとから設定で「かならずやる」に変えると、その項目は操作できなくなります。直すには一度「かならずやる」を外して、お子さんに「{SCREEN.decideDo}」へ戻してもらってから付け直してください。
	</p>

	<h3><Backpack size={16} class="inline align-middle" /> {SCREEN.schoolStartTitle}</h3>
	<p>
		上ばきを洗う、名札を出すなど、新学期に向けた準備の一覧です。押すたびに完了と未完了が入れかわります。期限ごとにまとまって表示され、<strong
			>夏休みが終わったあとも使えます</strong
		>。
	</p>

	<h3><Trophy size={16} class="inline align-middle" /> {SCREEN.rewardTitle}</h3>
	<p>{SCREEN.rewardHint}。</p>
	<ul>
		<li>これまでの<strong>合計点</strong>（チャレンジの加点も入ります）が伸びていきます</li>
		<li>
			ランクの必要点は「設定した1日の平均点 × 夏休みの日数」で自動計算されます。たとえば平均80点・40日なら3200点です
		</li>
		<li>ランクごとに<strong>ごほうびの品</strong>を書いておくと、いっしょに表示されます</li>
		<li>
			<strong>いまのペースだとどこまで届くか</strong>の予想も出ます（今日を除いた、終わった日の平均から計算します）
		</li>
	</ul>
	<p class="text-text-dim">ごほうびを1つも設定していない場合、このカードは出ません。</p>

	<h3><Tv size={16} class="inline align-middle" /> {SCREEN.timerTitle}</h3>
	<p>
		テレビやゲームの時間をはかるおまけの機能です。<strong>点数には関係しません。</strong
		>画面のいちばん上のチップを押すと操作画面が開きます。
	</p>
	<ul>
		<li>
			<UiLabel><Play size={13} />{SCREEN.timerStart}</UiLabel> … 見はじめたときに押します
		</li>
		<li>
			<UiLabel><Square size={13} />{SCREEN.timerStop}</UiLabel> … 消したときに押します
		</li>
		<li>
			<UiLabel><Play size={13} />{SCREEN.timerResume}</UiLabel> … 途中でまたつけたときに押します
		</li>
	</ul>
	<p>
		<strong>リセットのボタンはありません。</strong>日本時間の夜0時になると自動で0にもどります。上限（初期値は120分）を超えると警告の色になりますが、計測は止まりません。上限は設定画面の「せいかつ」タブで変えられます。
	</p>
	<EditionNote only="docker" {edition}>
		<p>
			テレビの前の端末で押した時間を、<strong>別の部屋の端末からも見られます</strong
			>（5秒ごとに読み直します）。時間はサーバーの時計を基準にします。
		</p>
	</EditionNote>
	<EditionNote only="lite" {edition}>
		<p>
			時間を数えるのは<strong>押した端末の中だけ</strong>です。別の端末から残り時間を見ることはできません。
		</p>
	</EditionNote>
</ManualSection>

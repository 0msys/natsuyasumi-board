<script lang="ts">
	import { CalendarRange, Flame, Pencil, Star } from '@lucide/svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import { SCREEN } from '../labels';

	// この節だけ edition を受け取らない。履歴と過去日の修正は両版でまったく同じ操作で、
	// 使わない prop を持つと「ここにも版差があるのでは」と読ませてしまう。
	// 版差が生まれたときに、ほかの節と同じ形の prop を足すこと。
</script>

<ManualSection id="history">
	<h3><CalendarRange size={16} class="inline align-middle" /> {SCREEN.historyTitle}</h3>
	<p>
		夏休みの初日から最終日までが、日ごと・項目ごとの表になっています。横にスクロールします。「つけ忘れた日」がひと目で分かります。
	</p>
	<ul>
		<li>その日の基本点と、チャレンジを含めた合計点が出ます</li>
		<li>
			<Flame size={13} class="inline align-middle" /> 連続満点 …
			いま何日つづいているか、いちばん長かったのは何日か、満点は通算何回かが出ます
		</li>
		<li>
			おでかけの日は日づけの色が変わり、押すと予定の名前が出ます。おでかけの日につけ忘れがあっても、連続はとぎれません
		</li>
		<li>今日より先の日は押せません</li>
	</ul>

	<h3><Pencil size={16} class="inline align-middle" /> 前の日を直す</h3>
	<p>表の日づけを押すと、その日の記録が開きます。</p>
	<ul>
		<li>
			過去の日は、まず「見るだけ」で開きます（「{SCREEN.dayEditViewOnly}」と出ます）。うっかり書き換えないためです
		</li>
		<li>
			<UiLabel><Pencil size={13} />{SCREEN.dayEditButton}</UiLabel> を押すと直せるようになります
		</li>
		<li>今日の分は最初から直せる状態で開くので、このボタンは出ません</li>
	</ul>
	<p>
		直せるものは今日のチェックと同じです。3つのボタン、メモ欄、そして
		<UiLabel><Star size={13} />{SCREEN.challengeTitle}</UiLabel> も直せます。
	</p>
	<p>
		チャレンジが開く条件も今日の画面と同じで、その日の「しゅくだい」を全部やったときです。この画面の中でチェックを足すと、その場でチャレンジが開きます。点が足されるのは、その日が100点になったときだけです。
	</p>
	<p>
		直すと、合計点・ごほうびランク・連続満点もその場で計算し直されます。夏休みが終わったあとでも直せます。
	</p>
</ManualSection>

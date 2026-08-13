<script lang="ts">
	import {
		CalendarPlus,
		Download,
		Lock,
		Pencil,
		Plus,
		RefreshCw,
		Save,
		Settings,
		Trash2,
		TriangleAlert,
		Upload,
		Volume2
	} from '@lucide/svelte';
	import { SECTIONS, type SectionId } from '$lib/admin/sectionDefs';
	import EditionNote from '../EditionNote.svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import type { Edition } from '../edition';

	let { edition }: { edition: Edition } = $props();

	// タブの名前は $lib/admin/sectionDefs.ts から引き、説明だけをここで持つ。
	// Record<SectionId, string> なので、タブを増やすと bun run check が
	// 「説明が無い」と言って落ちる＝マニュアルの書き忘れをコンパイル時に捕まえる。
	const TAB_NOTES: Record<SectionId, string> = {
		basic: 'よみがな、学年、夏休みの期間、始業式。docker 版では読み上げの声もここで選びます。',
		habits:
			'早起き・歯みがきなどの毎日の習慣。並べ替えができるのはここだけです。「はじめとおわりだけ」（夏休みのはじめと終わりの数日だけ出す）の設定、「中止」を選べるようにするかどうか、テレビタイマーの上限も、このタブにあります。',
		daily: 'ドリル・日記など、毎日やる宿題。宿題ごとにメモ欄（文字・えらぶ・分と秒）を足せます。',
		challenges:
			'宿題を全部やった日に開くおまけの項目（点が入るのは、せいかつも全部できて100点になった日だけ）。1件25点は変えられないので、決めるのは名前だけです。',
		rewards:
			'ランクの名前、1日の平均点、ごほうびの品。必要点は「平均点 × 夏休みの日数」で自動計算されます。平均点は必ず増える順に並べてください（同じ点は保存できません）。',
		oneshot:
			'夏休み中に一度やればいい宿題。「できた／まだ」で数える完了型と、冊数を数える型があります。「やってもやらなくてもいい」にすると、お子さんが先に やる／やらない を選べます。',
		choice:
			'「工作・自由研究・料理から1つ以上」のように、グループの中から決めた数だけ選ぶ宿題。最低必要数は選択肢の数を超えられません。',
		schoolstart: '上ばきを洗う、名札を出すなど、新学期の準備と期限。',
		away: 'おでかけ・帰省の予定。この日はつけ忘れがあっても連続満点がとぎれません。'
	};
</script>

<ManualSection id="admin">
	<p>
		お子さんの画面の右上、<Settings size={13} class="inline align-middle" />
		歯車から入る親用の画面です。
	</p>

	<EditionNote only="docker" {edition}>
		<p class="flex items-center gap-1">
			<Lock size={16} class="shrink-0" />PIN をかけている場合は、ここで数字を聞かれます。
		</p>
	</EditionNote>

	<h3>設定の一覧でできること</h3>
	<p>登録した子どもが1人ずつ並びます。それぞれの行にあるボタンは次のとおりです。</p>
	<ul>
		<li><UiLabel>ひらく</UiLabel> … その子の設定を直す画面へ進みます</li>
		<li>
			<UiLabel><CalendarPlus size={13} />来年ぶんをつくる</UiLabel> …
			いまの設定をもとに来年の分を作ります。学年が1つ上がり、日づけが1年後にずれます。項目と名前は引き継ぎますが、<strong
				>今年のチェック記録は引き継ぎません</strong
			>。おでかけ予定は空になります（小6の設定からは作れません）
		</li>
		<li>
			<UiLabel><Download size={13} />エクスポート（JSON）</UiLabel> …
			その年の設定だけをファイルに書き出します（チェック記録は入りません）。ファイル名は「年-名前.json」です
		</li>
		<li>
			<UiLabel><Pencil size={13} />名前の変更</UiLabel> …
			設定だけでなく、その子の記録もまとめて新しい名前へ移します
		</li>
		<li>
			<UiLabel><Trash2 size={13} />削除</UiLabel> …
			その子の<strong>全部の年</strong>の設定を消します。まちがい防止のため、子どもの名前を打ち込むまで押せません
		</li>
	</ul>
	<p>
		<strong>設定を消しても、チェック記録は消えません。</strong
		>書き出しておいた設定ファイルを取り込み直せば、残っていた記録とまた結びつきます。
	</p>
	<p>いちばん下には2つのボタンがあります。</p>
	<ul>
		<li><UiLabel><Plus size={13} />あたらしくつくる</UiLabel> … 別の子どもや別の年を足します</li>
		<li>
			<UiLabel><Upload size={13} />JSON をインポート</UiLabel> … {#if edition === 'lite'}書き出したファイルを読み込みます。設定1年ぶんのファイルか、端末まるごとのバックアップかは自動で見分けます{:else}書き出した設定1年ぶんのファイルを読み込みます{/if}。すでに同じ子ども・同じ年がある場合は取り込めません
		</li>
	</ul>

	<EditionNote only="lite" {edition}>
		<p>
			この画面のいちばん上にバックアップのカードが出ます（→
			<a href="#data" class="text-accent underline">データの保存とバックアップ</a>）。
		</p>
	</EditionNote>
	<EditionNote only="lite" {edition}>
		<p class="flex items-center gap-1">
			<TriangleAlert size={16} class="shrink-0 text-danger" />
			<span class="sr-only">注意: </span>
			赤い「記録が保存されません」の帯が出たときは、プライベートブラウズで開いています。ふつうのタブで開き直してください。
		</p>
	</EditionNote>

	<h3>その子の設定を直す</h3>
	<p>
		2年ぶん以上を登録している子には、上に年のタブが出ます。右の
		<UiLabel>この年をけす</UiLabel> は、<strong>いま表示している年だけ</strong>を消します。
	</p>
	<p>設定は次の {SECTIONS.length} 枚のタブに分かれています。</p>
	<ul>
		{#each SECTIONS as s (s.id)}
			<li>{s.label} … {TAB_NOTES[s.id]}</li>
		{/each}
	</ul>

	<h3>保存のしかた</h3>
	<p>
		<strong
			>いちばん下の帯にある <UiLabel><Save size={13} />ほぞんする</UiLabel>
			を押すまで、直した内容は保存されません。</strong
		>タブを行き来しても入力は消えないので、全部直してから最後に一度押せば大丈夫です。
	</p>
	<ul>
		<li>
			タブの右肩の数字は、直すところの数です。<strong class="text-danger">赤</strong
			>は「直さないと保存できない」、<strong class="text-attn">黄</strong
			>は「保存はできるが気をつけたほうがいい」という意味です
		</li>
		<li>帯に出た一覧を押すと、その場所へ飛びます</li>
		<li>学年でまだ習わない漢字を使うと注意が出ます。ふりがなの付きかたもその場で確認できます</li>
		<li>
			記録に使われている項目を消そうとすると、「何日ぶんの記録が使えなくなるか」を出して確認します。夏休みの途中で項目を足したり消したりすると、過去の日の点数が変わることがあるので、その注意も出ます
		</li>
		<li>保存せずに画面を離れようとすると確認が出ます</li>
	</ul>

	<EditionNote only="docker" {edition}>
		<p>
			「きほん」タブでは <Volume2 size={13} class="inline align-middle" />
			読み上げの声を選べます。<UiLabel><Volume2 size={13} />ためし聞き</UiLabel>
			でその場で確かめられます。VOICEVOX が止まっているときは、使えないことが表示されます。
		</p>
	</EditionNote>

	<h3>「ほかで先に保存されています」と出たら</h3>
	<EditionNote only="docker" {edition}>
		<p>
			別の端末（または別のタブ）で先に保存されたときに出ます。上書きしてしまわないよう、保存は止まります。
		</p>
	</EditionNote>
	<EditionNote only="lite" {edition}>
		<p>同じ端末の別のタブで先に保存されたときに出ます。上書きしてしまわないよう、保存は止まります。</p>
	</EditionNote>
	<p>
		<UiLabel><RefreshCw size={13} />読み直す</UiLabel> を押すと最新の内容を読み込みます。<strong
			>このとき、いま直していた内容は捨てられます。</strong
		>消したくない変更があれば、先にメモしてから押してください。
	</p>
</ManualSection>

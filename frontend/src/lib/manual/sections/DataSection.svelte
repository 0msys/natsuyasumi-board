<script lang="ts">
	import { Download, HousePlus, Settings, TriangleAlert, Upload } from '@lucide/svelte';
	import ManualSection from '../ManualSection.svelte';
	import UiLabel from '../UiLabel.svelte';
	import type { Edition } from '../edition';

	// ここは節のほぼ全部が版で入れかわるので、EditionNote の囲みではなく
	// 素の分岐で本文ごと差し替える（囲みが節の丈だけ続くのは読みにくいため）。
	let { edition }: { edition: Edition } = $props();
</script>

<ManualSection id="data">
	{#if edition === 'lite'}
		<p>
			<strong>記録はこの端末のブラウザの中だけにあります。</strong
			>サーバーはなく、どこにも送信されません。そのぶん、端末を替えたときやブラウザのデータを消したときに、記録も消えます。
		</p>

		<h3><HousePlus size={16} class="inline align-middle" /> まず「ホーム画面に追加」</h3>
		<p>
			お子さんが使う端末では、必ずホーム画面に追加してから使ってください。ふつうのタブのままだと、しばらく開かなかったときにブラウザが保存データを消してしまうことがあります（iPhone
			の Safari は7日間ひらかなかったサイトのデータを消します）。
		</p>
		<ul>
			<li>iPhone・iPad … 共有ボタン → 「ホーム画面に追加」</li>
			<li>Android・パソコン … ブラウザのメニュー → 「アプリをインストール」「ホーム画面に追加」</li>
		</ul>
		<p>一度ひらいた端末なら、電波がなくても（機内モードでも）使えます。</p>

		<h3><Download size={16} class="inline align-middle" /> バックアップのとりかた</h3>
		<p>
			設定画面（<Settings size={13} class="inline align-middle" />
			歯車）のいちばん上にあるカードから行います。ここでとれるのは、設定も記録もぜんぶ入った1つのファイルです。
		</p>
		<ol class="mb-2 list-decimal pl-5">
			<li class="mb-1">
				<UiLabel><Download size={13} />バックアップする</UiLabel> を押します。ファイルが1つできます
			</li>
			<li class="mb-1">ダウンロードのフォルダに、ファイルがあるか自分で確かめます</li>
			<li class="mb-1">
				確かめられたら <UiLabel>ほぞんできた</UiLabel> を押します
			</li>
		</ol>
		<p>
			<strong>3つめを押すまで、「さいごのバックアップ」の日づけは変わりません。</strong
			>ブラウザにファイルを渡せたかどうかは、アプリからは分からないためです。ファイルが見あたらなければ
			<UiLabel>できていない</UiLabel> を押してください。日づけは進まないので、あとでやり直せます。
		</p>
		<p class="text-text-dim">
			前回から日が経っていたり、変更がたまっていたりすると、設定画面で理由といっしょに催促が出ます。お子さんの画面では、歯車に赤い点が付くだけです。
		</p>

		<h3><Upload size={16} class="inline align-middle" /> もどす（復元）</h3>
		<p>
			設定画面の <UiLabel><Upload size={13} />もどす</UiLabel>
			から、バックアップのファイルを選びます。
		</p>
		<p class="flex items-start gap-1">
			<TriangleAlert size={16} class="mt-0.5 shrink-0 text-danger" />
			<span
				><strong>いまこの端末に入っている内容は、まるごと入れかわります。</strong
				>確認が出るので、よく読んでから進めてください。</span
			>
		</p>

		<h3>新しい端末に引っ越すとき</h3>
		<ol class="mb-2 list-decimal pl-5">
			<li class="mb-1">古い端末で「バックアップする」→「ほぞんできた」</li>
			<li class="mb-1">できたファイルを新しい端末へ送ります（メール、AirDrop、クラウドなど）</li>
			<li class="mb-1">新しい端末でこのアプリをひらき、「ホーム画面に追加」</li>
			<li class="mb-1">設定画面の「もどす」でそのファイルを選びます</li>
		</ol>
	{:else}
		<p>
			記録はおうちのサーバーの中にあります。置き場所は、アプリを動かしているフォルダの中にある
			<code class="rounded bg-surface2 px-1">data</code> という名前のフォルダです。
		</p>

		<h3>複数の端末で使う</h3>
		<p>
			同じWi-Fiにつながっていれば、何台からでも同じ記録が見られます。リビングのタブレットでお子さんがチェックし、親のスマホで進みぐあいを見る、といった使い方ができます。端末ごとに設定をそろえる必要はありません。
		</p>
		<p class="flex items-start gap-1">
			<TriangleAlert size={16} class="mt-0.5 shrink-0 text-attn" />
			<span
				>おうちの中だけで使うつくりです。<strong
					>インターネットからつながるようにしないでください。</strong
				></span
			>
		</p>

		<h3><Download size={16} class="inline align-middle" /> バックアップのとりかた</h3>
		<p>
			<strong>画面の中にバックアップのボタンはありません。</strong>サーバーの
			<code class="rounded bg-surface2 px-1">data</code>
			フォルダを、まるごとどこかにコピーしておいてください。それがバックアップです。もどすときは、コピーしたフォルダを元の場所へ書きもどします。
		</p>
		<p class="text-text-dim">
			操作のしかたが分からない場合は、このアプリを入れてくれた方に「data
			フォルダのコピー」を頼んでください。
		</p>

		<h3>端末を替えるとき</h3>
		<p>
			記録はサーバーにあるので、端末を替えても何もしなくて大丈夫です。新しい端末で同じアドレスをひらけば、そのまま続きが見られます。
		</p>
	{/if}

	<h3>設定だけを持ち運ぶ（両方の版で使えます）</h3>
	<p>
		設定の一覧にある <UiLabel><Download size={13} />エクスポート（JSON）</UiLabel> と
		<UiLabel><Upload size={13} />JSON をインポート</UiLabel>
		は、1年ぶんの設定だけを持ち運ぶ機能です。チェック記録は入りません。
	</p>
	<p>
		この形式は lite 版と docker 版で共通なので、「lite 版で作った設定を docker
		版へ移す」といった使い方ができます（記録は移りません）。
	</p>
</ManualSection>

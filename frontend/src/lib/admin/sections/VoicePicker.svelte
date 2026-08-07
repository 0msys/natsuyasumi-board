<script lang="ts">
	// 読み上げの声（VOICEVOX の話者）を子どもごとにえらぶ。きほんタブの中で使う。
	// 保存するのは話者ID（doc.voice.speaker）で、label は画面表示用のキャッシュ
	// （VOICEVOX が止まっていても「だれの声にしてあるか」を出せる）。
	// 一覧は /api/tts/speakers（VOICEVOX の /speakers を読み上げ用スタイルだけに絞ったもの）。
	// 試聴は保存前の話者で鳴らすので、$lib/summer/speakText の previewVoice を使う。
	import { onDestroy, onMount } from 'svelte';
	import { Volume2 } from '@lucide/svelte';
	import { api } from '$lib/api';
	import type { TtsSpeaker } from '$lib/api';
	import { previewVoice } from '$lib/summer/speakText';
	import type { AdminDraft } from '../draft.svelte';

	let { draft }: { draft: AdminDraft } = $props();

	// 一覧に無い話者IDが設定されているときの select の値。専用の値を持たせないと
	// 「きほんのこえ（おまかせ）」が選択済みに見えてしまい、それを選び直しても change が
	// 発火せず＝画面から設定を消せなくなる（保存し直すまで警告が出たまま）。
	const UNKNOWN = '__unknown__';

	const doc = $derived(draft.doc!);

	let speakers = $state<TtsSpeaker[]>([]);
	let defaultSpeaker = $state(3);
	// engineUp は VOICEVOX 自体の死活。一覧だけ取れないこと（engineUp かつ speakers 空）が
	// あるので、この2つを別々に持つ——一時的に一覧が引けないだけのときに
	// 「VOICEVOX がうごいていません」と誤った案内を出さないため。
	let engineUp = $state(false);
	// この版に読み上げ機能そのものがあるか（lite 版は false）。engineUp とは別物。
	let supported = $state(true);
	let loading = $state(true);
	let previewing = $state(false);
	let previewError = $state<string | null>(null);

	const listAvailable = $derived(engineUp && speakers.length > 0);

	// この欄が画面から消えたか（別タブへ切替・ほかの子へ移動・管理画面から離脱）。
	// 合成は数秒かかるので、その間に消えることがある。消えたあとに鳴らすと
	// 「もう見ていない画面の音」が出てくるし、$derived を破棄後に読むこと自体も安全でない。
	let destroyed = false;
	onDestroy(() => (destroyed = true));

	onMount(() => {
		api
			.ttsSpeakers()
			.then((r) => {
				speakers = r.speakers;
				defaultSpeaker = r.default_speaker;
				engineUp = r.available;
				supported = r.supported !== false;
			})
			.catch(() => (engineUp = false))
			.finally(() => (loading = false));
	});

	// 未設定（voice ごと無い）＝サーバ既定の話者で読む
	const currentId = $derived(typeof doc.voice?.speaker === 'number' ? doc.voice.speaker : null);
	// いま選ばれている話者IDを持つキャラクター。一覧に無い ID（よその家の定義を取り込んだ等）は null
	const currentCharacter = $derived(
		currentId === null ? null : (speakers.find((s) => s.styles.some((st) => st.id === currentId)) ?? null)
	);
	const currentStyles = $derived(currentCharacter?.styles ?? []);
	// 一覧に無い ID が設定されている（よその家の定義を取り込んだ・VOICEVOX の版ちがい）
	const currentIsUnknown = $derived(currentId !== null && currentCharacter === null);
	// 試聴に渡す話者ID。「一覧から今えらんだ声」のときだけ直接指定する。
	// 未設定や一覧に無い ID のときは undefined＝サーバの既定（実在検査つき）に任せる。
	// ここで未知の ID をそのまま送ると、子どもページでは既定の声へ落ちて鳴るのに試聴だけ
	// 400 になり、しかも catch が「VOICEVOX がうごいているか確かめて」と誤案内していた。
	const previewId = $derived(currentCharacter !== null ? (currentId ?? undefined) : undefined);
	const sampleText = $derived(
		`${doc.child_kana || doc.child || 'きみ'}さん、こんにちは。きょうも いっしょに がんばろうね。`
	);

	function setVoice(speaker: number, label: string) {
		doc.voice = { speaker, label };
		draft.markDirty();
	}
	function clearVoice() {
		delete doc.voice;
		draft.markDirty();
	}
	function pickCharacter(name: string) {
		if (!name || name === UNKNOWN) {
			clearVoice();
			return;
		}
		const character = speakers.find((s) => s.name === name);
		if (!character?.styles.length) return;
		const style = character.styles[0];
		setVoice(style.id, `${character.name}（${style.name}）`);
	}
	function pickStyle(id: number) {
		const style = currentStyles.find((s) => s.id === id);
		if (!style || !currentCharacter) return;
		setVoice(style.id, `${currentCharacter.name}（${style.name}）`);
	}

	async function playSample() {
		// 合成には数秒かかる。そのあいだ「ためし聞き」ボタンは disabled になるが、
		// キャラクター／はなしかたの select は操作できるし、別タブへ移ることもできる。
		// えらび直したあとに前の声が鳴ると、画面の表示と聞こえる声が食い違う（しかも
		// 「この声だ」と誤解して保存する）。この欄ごと消えたあとに鳴るのは、もう見ていない
		// 画面の音が出てくるということ。送ったときの こえ を覚えておき、返ってきた時点で
		// どちらかが起きていたら鳴らさないしエラーも出さない。
		// 判定は再生の直前（previewVoice の中）で行う——ここで await のあとに確かめても、
		// そのときにはもう鳴っている。destroyed を先に見るのは、破棄後の $derived
		// （previewId）を読まないため。
		const requested = previewId;
		const stillSelected = () => !destroyed && previewId === requested;
		previewing = true;
		previewError = null;
		try {
			await previewVoice(sampleText, requested, stillSelected);
		} catch (e) {
			if (!stillSelected()) return; // 追い越された古い試聴の失敗は黙って捨てる
			// 400 は「この話者では合成できない」＝ VOICEVOX は生きている。
			// 503・通信断だけが「うごいていない」。混ぜると案内が嘘になる。
			previewError = String(e).includes('→ 400')
				? 'この こえでは ためし聞きできませんでした（べつの こえを えらんでください）'
				: 'ためし聞きできませんでした（VOICEVOX がうごいているか確かめてください）';
		} finally {
			previewing = false;
		}
	}
</script>

<!-- この版に読み上げが無ければ、欄ごと出さない。
     「VOICEVOX がうごいていません」という案内は、docker 版でしか意味を持たない。 -->
{#if supported}
<div class="flex flex-col gap-2 rounded-lg bg-surface2/60 p-3">
	<div class="flex items-center justify-between gap-2">
		<span class="text-sm font-bold text-text-base">よみあげの こえ</span>
		{#if engineUp}
			<!-- 一覧が出せなくても、いま設定されている こえ の確認はできる -->
			<button
				type="button"
				disabled={previewing}
				onclick={() => void playSample()}
				class="flex shrink-0 items-center gap-1 rounded-md border border-border-dim px-2.5 py-1 text-xs font-bold text-text-base disabled:opacity-50"
			>
				<Volume2 size={14} />{previewing ? 'さいせい中…' : 'ためし聞き'}
			</button>
		{/if}
	</div>

	{#if loading}
		<p class="text-xs text-text-dim">こえの一覧をよみこんでいます…</p>
	{:else if !listAvailable}
		<!-- 一覧が出せなくてもラベルは出せる（設定は消さずにそのまま保存される） -->
		<p class="text-sm text-text-base">
			いまの こえ: {doc.voice?.label ?? `きほんのこえ（話者ID ${defaultSpeaker}）`}
		</p>
		{#if engineUp}
			<p class="text-xs text-text-dim">
				VOICEVOX は うごいていますが、こえの一覧を とれませんでした。すこししてから
				ひらきなおしてください（いまの こえ の設定は そのままです）。
			</p>
		{:else}
			<p class="text-xs text-text-dim">
				VOICEVOX がうごいていないので、こえの一覧を出せません（<code>--profile voice</code>
				をつけて起動すると えらべます）。
			</p>
		{/if}
	{:else}
		<label class="flex flex-col gap-1">
			<span class="text-xs text-text-dim">キャラクター</span>
			<select
				value={currentIsUnknown ? UNKNOWN : (currentCharacter?.name ?? '')}
				onchange={(e) => pickCharacter(e.currentTarget.value)}
				class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
			>
				{#if currentIsUnknown}
					<option value={UNKNOWN}>この VOICEVOX に無い こえ（話者ID {currentId}）</option>
				{/if}
				<option value="">きほんのこえ（おまかせ）</option>
				{#each speakers as s (s.name)}
					<option value={s.name}>{s.name}</option>
				{/each}
			</select>
		</label>

		{#if currentStyles.length > 1}
			<label class="flex flex-col gap-1">
				<span class="text-xs text-text-dim">はなしかた</span>
				<select
					value={String(currentId)}
					onchange={(e) => pickStyle(Number(e.currentTarget.value))}
					class="rounded-md border border-border-dim bg-surface px-2 py-1.5 text-sm text-text-base"
				>
					{#each currentStyles as st (st.id)}
						<option value={String(st.id)}>{st.name}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if currentIsUnknown}
			<!-- よその家からインポートした定義など。読み上げ自体はサーバが既定の声へ落として動かす -->
			<p class="text-xs text-warn">
				いま設定されている こえ（{doc.voice?.label ?? `話者ID ${currentId}`}）は、この VOICEVOX に
				入っていません。えらび直すまで きほんのこえで読み上げます。
			</p>
			<button
				type="button"
				onclick={clearVoice}
				class="self-start rounded-md border border-border-dim px-2.5 py-1 text-xs font-bold text-text-base"
			>
				きほんのこえに もどす
			</button>
		{/if}
	{/if}

	<p class="text-xs text-text-dim">
		子どもごとに ちがう こえにできます。生成した音声を家の外へ出すときは、
		<a
			href="https://voicevox.hiroshiba.jp/term/"
			target="_blank"
			rel="noreferrer"
			class="underline">VOICEVOX と各キャラクターの利用規約</a
		>にしたがってください。
	</p>
	{#if previewError}
		<p class="text-xs text-danger">{previewError}</p>
	{/if}
</div>
{/if}

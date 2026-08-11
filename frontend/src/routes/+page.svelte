<script lang="ts">
	// 子どもページ: きょうのチェック（3値）・がんばりスコア・宿題進捗・
	// 新学期じゅんび・全期間の履歴グリッド（過去日修正）。
	// 書き込みは confirm-before-update（サーバ成功後に全再取得。LAN では体感即時）。
	import { onDestroy, onMount } from 'svelte';
	import { Settings, Sun, TriangleAlert } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { childErrorText } from '$lib/api/apiError';
	import { backupLevel } from '$lib/backup/level';
	import type {
		SummerCheckStatus,
		SummerDecision,
		SummerHistoryDay,
		SummerRewards,
		SummerState
	} from '$lib/api';
	import SummerCelebration from '$lib/summer/SummerCelebration.svelte';
	import SummerRewardChart from '$lib/summer/SummerRewardChart.svelte';
	import SummerCommentCard from '$lib/summer/SummerCommentCard.svelte';
	import SummerDayEditModal from '$lib/summer/SummerDayEditModal.svelte';
	import SummerHistoryGrid from '$lib/summer/SummerHistoryGrid.svelte';
	import SummerHomeworkProgress from '$lib/summer/SummerHomeworkProgress.svelte';
	import SummerMediaTimerChip from '$lib/summer/SummerMediaTimerChip.svelte';
	import SummerMediaTimerOverlay from '$lib/summer/SummerMediaTimerOverlay.svelte';
	import SummerSchoolStartItems from '$lib/summer/SummerSchoolStartItems.svelte';
	import SummerSpecialChallenge from '$lib/summer/SummerSpecialChallenge.svelte';
	import SummerTodayChecks from '$lib/summer/SummerTodayChecks.svelte';
	import Ruby from '$lib/summer/Ruby.svelte';
	import { playFanfare } from '$lib/summer/sfx';
	import { setTtsAvailability, speakSummerText, unlockSummerSpeech } from '$lib/summer/speakText';
	import { mediaTimerStore, type MediaTimerStoreState } from '$lib/summer/mediaTimerStore';
	import { fmt } from '$lib/summer/uiText';
	import { mdOf } from '$lib/summer/dateLabel';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// 読み上げの合成は数秒かかる。そのあいだに子どもを切り替えられる（/?child=… は
	// 同じルート内のクライアント遷移）し、ページごと離れることもある。返ってきた時点で
	// 対象が変わっていたら鳴らさない——でないと、切り替えた先の画面に前の子あての
	// コメントが前の子の声で流れる。判定は再生の直前（speakSummerText の中）で行う。
	let destroyed = false;
	onDestroy(() => (destroyed = true));
	// 初期表示は load 結果で開始する（$effect は SSR で走らないため、初期値で与えないと
	// サーバ描画が「よみこめなかった」枝に落ちる）。以後は refresh() と下の $effect が上書きする。
	// svelte-ignore state_referenced_locally
	let summer = $state<SummerState | null>(data.summer as SummerState | null);
	// いま画面に出しているデータが「誰のものか」。data.child（URL 側）はナビゲーションで
	// 即座に変わるが、summer は下の $effect が入れ替えるまで前の子のままで、1描画ぶんズレる。
	// そのズレた1描画で「新しい子の名前＋前の子の記録」という組み合わせが生まれるので、
	// summer 由来のデータと組にして使う child は必ずこちらを使う（同じ出所＝必ず整合する）。
	// マウント時に1回だけ値を読む処理（メモ入力バッファの種まき）は、これを外すと古い値を掴む。
	const shownChild = $derived(summer?.child ?? data.child);
	const speakGuard = (child: string) => () => !destroyed && shownChild === child;
	let errorMsg = $state<string | null>(null);
	let editDay = $state<SummerHistoryDay | null>(null);
	let anchorY = $state<number | null>(null);
	let ttsAvailable = $state(false);
	// バックアップが要りそうか（ブラウザ保存の版だけ true になりうる）。
	// 子どもを急かしたくないので画面に文言は出さず、せっていの歯車に小さな印だけ付ける。
	let backupNeeded = $state(false);
	let errorTimer: ReturnType<typeof setTimeout> | null = null;
	// base100 花火と同時のランク演出は遅延実行する。ページ離脱時に未発火だと音声が残るため
	// id を保持して cleanup で必ず解除する。
	let rankCelebrationTimer: ReturnType<typeof setTimeout> | null = null;
	// svelte-ignore non_reactive_update
	let celebration: SummerCelebration | undefined;
	// アウトメディア視聴タイマー（サーバ権威・ストアが5秒ポーリング＝複数端末で共有）
	let mediaTimer = $state<MediaTimerStoreState>(mediaTimerStore.state);

	// ?child= の切り替え（ナビゲーション）で load 結果に追従する。以後は refresh() が上書きする。
	// あわせて「前の子あてに仕掛けたまま」のものを畳む。子どもの切替は同じルート内の遷移で
	// このページは作り直されない＝onMount の後始末は走らないので、ここで畳まないと残る。
	//   - 過去日モーダル: 前の子の日を指したままになり、refresh() が同じ日付で新しい子の
	//     記録へ黙ってつなぎ替える（＝別の子の記録を編集してしまう）
	//   - ランク到達の遅延演出: 満点花火と重なったときは 5.2秒後に発火する。前の子の
	//     ランク名のバナーが新しい子の画面に出て、新しい子の声で読み上げられる
	//   - エラー表示: 前の子への書き込み失敗の文言が、切り替えた先で最大6秒出たままになる
	$effect(() => {
		summer = data.summer as SummerState | null;
		editDay = null;
		if (rankCelebrationTimer) {
			clearTimeout(rankCelebrationTimer);
			rankCelebrationTimer = null;
		}
		if (errorTimer) {
			clearTimeout(errorTimer);
			errorTimer = null;
		}
		errorMsg = null;
	});
	$effect(() => {
		// 誰の画面かも決まらなかったとき（load が保存を読めなかった）は始めない。
		// 空の子ども名で5秒ごとに引くと、失敗するだけの問い合わせが延々と並ぶ。
		if (data.child) mediaTimerStore.setup(data.child);
	});

	// ランク英字の読み（VOICEVOX 発話用。C→シー 等でアルファベット読みを確定させる）
	const RANK_KANA: Record<string, string> = { c: 'シー', b: 'ビー', a: 'エー', s: 'エス' };

	// achieved_key のランク序数（未達は -1）。上がった遷移だけをランク到達とみなすための比較材料。
	function rankOrdinal(rw: SummerRewards | null | undefined, key: string | null): number {
		if (!rw || !key) return -1;
		return rw.ranks.findIndex((r) => r.key === key);
	}

	// ランク到達演出: 花火バナー（文言差し替え）＋読み上げ。ポーリング起点の自動再生は
	// ブラウザに拒否されうるので無音フォールバック（花火は出る）。
	function celebrateRank(rank: { key: string; label: string }) {
		const ui = summer?.ui;
		if (!ui) return;
		celebration?.play({
			title: fmt(ui.rank_achieved_title, { rank: rank.label }),
			subtitle: ui.rank_achieved_sub
		});
		const child = shownChild;
		void speakSummerText(
			fmt(ui.rank_achieved_speech, { rank: RANK_KANA[rank.key] ?? rank.key }),
			child,
			speakGuard(child)
		).catch(() => {});
	}

	async function refresh() {
		try {
			const prev = summer?.today_score?.score ?? null; // base（満点花火の基準）
			const prevTotal = summer?.today_score?.total ?? null; // total（王冠ファンファーレの基準）
			const prevRewards = summer?.rewards ?? null; // ランク到達検知（取得前にキャプチャ）
			// 切替をまたいだ応答は捨てる（前の子の state を新しい子の画面へ書き戻さない）。
			// $effect は data.summer が変わったときしか走らないので、ここで上書きすると
			// 次のポーリングまで前の子の記録が出たままになる。
			const requested = data.child;
			const fetched = await api.summerState(requested);
			if (destroyed || data.child !== requested) return;
			summer = fetched;
			// 編集モーダルを開いたまま更新されたら中身も追従させる
			if (editDay && summer) {
				editDay = summer.history.find((h) => h.day === editDay!.day) ?? null;
			}
			// 満点への遷移（base <100 → 100）でだけ花火を打つ。初回ロード・リロード・
			// すでに100で開いた場合は prev===null か prev===100 なので発火しない。
			const cur = summer?.today_score?.score ?? null;
			const baseFired = prev !== null && prev < 100 && cur === 100;
			if (baseFired) celebration?.play();
			// 満点上限への遷移で効果音（花火とは別トリガ・別タイミング）。
			const curTotal = summer?.today_score?.total ?? null;
			const max = summer?.score_max ?? 0;
			if (prevTotal !== null && curTotal !== null && max > 100 && prevTotal < max && curTotal === max) {
				playFanfare();
			}
			// ランク到達: achieved_key の序数が上がった遷移でだけ発火（初回ロードは prevRewards===null で
			// 不発火、過去日修正での降格も序数が下がるので不発火）。base100 花火と同時なら play() の
			// playing ガードで潰されるため、play() 全長(4800ms)後に遅延実行する。
			const curRewards = summer?.rewards ?? null;
			if (prevRewards && curRewards && curRewards.achieved_key) {
				const prevOrd = rankOrdinal(prevRewards, prevRewards.achieved_key);
				const curOrd = rankOrdinal(curRewards, curRewards.achieved_key);
				if (curOrd > prevOrd) {
					const rank = curRewards.ranks.find((r) => r.key === curRewards.achieved_key);
					if (rank) {
						if (baseFired) {
							if (rankCelebrationTimer) clearTimeout(rankCelebrationTimer);
							rankCelebrationTimer = setTimeout(() => celebrateRank(rank), 5200);
						} else {
							celebrateRank(rank);
						}
					}
				}
			}
		} catch {
			// ポーリング失敗は前回表示を維持（次回に回復）
		}
	}
	onMount(() => {
		const t = setInterval(refresh, 60_000);
		// アウトメディア視聴タイマー: ストアを購読（setup は $effect が child 付きで行う）
		const unsub = mediaTimerStore.subscribe((s) => (mediaTimer = s));
		// バックアップの状態を1回だけ確認（この版に出番が無ければ supported:false）
		void api
			.backupStatus()
			.then((s) => {
				if (!s.supported) return;
				// しきい値の判定は $lib/backup/level ただ1か所（せっていの BackupCard と同じもの）。
				// ここに書き写すと、カードは普通の見た目なのに歯車だけ赤い、という日ができる。
				// 保存そのものが効いていない端末でも印を点ける。子どもの画面に文言は出さないが、
				// 親がせっていを開けば理由が書いてある。
				backupNeeded = s.storage_ephemeral || backupLevel(s) !== 'ok';
			})
			.catch(() => {});
		// VOICEVOX の死活を1回だけ確認（無ければ音声ボタンを出さない）
		void api
			.ttsStatus(data.child)
			.then((s) => {
				ttsAvailable = s.available;
				setTtsAvailability(s.available);
			})
			.catch(() => {
				ttsAvailable = false;
				setTtsAvailability(false);
			});
		return () => {
			clearInterval(t);
			// 仕掛けたままのタイマーは全部畳む（子どもの切替は上の $effect が畳む。
			// ここはページごと離れたとき）。
			if (rankCelebrationTimer) clearTimeout(rankCelebrationTimer);
			if (errorTimer) clearTimeout(errorTimer);
			unsub();
			mediaTimerStore.teardown();
		};
	});

	// 失敗の文言は $lib/api/apiError に集約してある（管理画面と同じ取り出しかた・
	// 見せかただけ子ども向け）。ここに書き写すと、片方だけ直った状態にまた戻る。
	function showError(e: unknown) {
		errorMsg = childErrorText(e);
		if (errorTimer) clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (errorMsg = null), 6000);
	}

	/** 記録の書き込み1回ぶんの共通処理（全ての書き込みはここを通す）.
	 *
	 *  対象の子を押した時点で1回だけ捕まえて run へ渡す（await をまたいで読み直すと、
	 *  その隙に切り替えられたとき別の子へ書き込む）。失敗の表示も「まだその子の画面か」を
	 *  確かめてから出す——切替の直前に飛んだ要求の失敗は切替後に届くので、素直に出すと
	 *  新しい子の画面に前の子あてのエラーが湧く（切替時に消しても、あとから作り直される）。
	 */
	async function write(run: (child: string) => Promise<unknown>): Promise<void> {
		const child = shownChild;
		try {
			await run(child);
			await refresh();
		} catch (e) {
			if (!destroyed && shownChild === child) showError(e);
		}
	}

	const setCheck = (day: string, itemKey: string, status: SummerCheckStatus) =>
		write((child) => api.summerSetCheck(child, day, itemKey, status));
	const toggleFlag = (itemKey: string) => write((child) => api.summerToggleFlag(child, itemKey));
	const setCount = (itemKey: string, value: number) =>
		write((child) => api.summerSetCount(child, itemKey, value));
	const setDecision = (itemKey: string, decision: SummerDecision) =>
		write((child) => api.summerSetDecision(child, itemKey, decision));
	// メモ（本のだいめい・計算タイム等）を1フィールドずつ保存（サーバが既存 meta にマージ）
	const setMeta = (day: string, itemKey: string, fieldKey: string, value: string | number | null) =>
		write((child) => api.summerSetMeta(child, day, itemKey, { [fieldKey]: value }));

	// 計算カードのストップウォッチ停止: done 化してから、はかったタイムをその duration メモへ保存。
	// meta は「やった」の行にしか書けない（サーバ検証）ので、必ず done を先行させる。
	// 書き込み先の fieldKey は必ず呼び元（欄を描いている側）から渡す。ここで名前を決め打つと、
	// 管理画面から足した欄（m_xxxxxx が振られる）では毎回「しらない メモの こうもくだよ」になる。
	async function onStopwatchStop(itemKey: string, fieldKey: string, seconds: number) {
		// 書き込みが2回あり、あいだに await が挟まる。日付も1回だけ捕まえる（日またぎで
		// 「done は昨日・タイムは今日」になるのを防ぐ）。子は write が捕まえて渡してくれる。
		const day = summer?.today;
		if (!day) return;
		await write(async (child) => {
			await api.summerSetCheck(child, day, itemKey, 'done');
			await api.summerSetMeta(child, day, itemKey, { [fieldKey]: seconds });
		});
	}
	// 褒めメッセージを VOICEVOX で読み上げる
	async function playComment() {
		const text = summer?.comment?.text;
		if (!text) return;
		const child = shownChild;
		const stillCurrent = speakGuard(child);
		try {
			await speakSummerText(text, child, stillCurrent);
		} catch (e) {
			if (stillCurrent()) showError(e); // 切替をまたいだ失敗は新しい子の画面に出さない
		}
	}
	function openDay(day: SummerHistoryDay, e: MouseEvent) {
		anchorY = e.clientY;
		editDay = day;
	}

</script>

<svelte:head>
	<title>なつやすみボード</title>
</svelte:head>

<div class="mx-auto max-w-screen-2xl p-3 lg:p-6">
	<header class="mb-4 flex items-center justify-between lg:mb-6">
		<h1 class="flex items-center gap-2 text-lg font-bold text-text-base lg:text-2xl">
			<Sun size={26} class="text-amber-500" />{#if summer}<Ruby
					text={fmt(summer.ui.header_title, { name: summer.child_kana })}
				/>{:else}{data.child ? `${data.child}のなつやすみ` : 'なつやすみ'}{/if}
		</h1>
		<div class="flex items-center gap-2 lg:gap-3">
			{#if data.children.length > 1}
				<nav class="flex items-center gap-1">
					{#each data.children as c (c.child)}
						<a
							href={`${resolve('/')}?child=${encodeURIComponent(c.child)}`}
							class="rounded-full px-3 py-1 text-xs font-bold lg:text-sm {c.child === data.child
								? 'bg-accent text-white'
								: 'bg-surface2 text-text-dim'}"
						>
							{c.child_kana}
						</a>
					{/each}
				</nav>
			{/if}
			{#if summer?.in_period}
				<SummerMediaTimerChip ui={summer.ui} timer={mediaTimer.timer} onOpen={() => mediaTimerStore.openOverlay()} />
			{/if}
			{#if summer}
				<span class="hidden text-xs text-text-dim sm:inline lg:text-sm">
					<Ruby
						text={fmt(summer.ui.period_range, {
							start: mdOf(summer.period.start),
							end: mdOf(summer.period.end),
							first: mdOf(summer.period.first_day_of_school)
						})}
					/>
				</span>
			{/if}
			<a
				href={resolve('/admin')}
				aria-label={backupNeeded ? 'せってい（バックアップをおすすめします）' : 'せってい'}
				title={backupNeeded ? 'せってい（バックアップをおすすめします）' : 'せってい'}
				class="relative text-text-dim/60"
			>
				<Settings size={16} />
				{#if backupNeeded}
					<span class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger" aria-hidden="true"
					></span>
				{/if}
			</a>
		</div>
	</header>

	{#if errorMsg}
		<div
			class="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500 lg:text-base"
		>
			<TriangleAlert size={18} class="shrink-0" />{errorMsg}
		</div>
	{/if}

	{#if !summer}
		<p class="text-sm text-text-dim lg:text-base">
			なつやすみの ページを よみこめなかったよ。すこししてから ひらきなおしてね。
		</p>
	{:else}
		{#if !summer.in_period}
			<div class="mb-4 rounded-lg bg-surface p-4 text-sm text-text-base lg:text-base">
				<Ruby text={summer.ui.period_ended} />
			</div>
		{/if}
		{#if summer.away_today}
			<div class="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 lg:text-base">
				<Ruby text={fmt(summer.ui.away_today, { away: summer.away_today })} />
			</div>
		{/if}

		<div class="grid grid-cols-1 items-start gap-4 lg:gap-6 xl:grid-cols-3">
			<div class="flex flex-col gap-4 lg:gap-6">
				{#if summer.in_period}
					<SummerTodayChecks
						ui={summer.ui}
						child={shownChild}
						habits={summer.habits}
						daily={summer.daily_homework}
						{ttsAvailable}
						onSet={(key, status) => setCheck(summer!.today, key, status)}
						onSetMeta={(key, field, value) => setMeta(summer!.today, key, field, value)}
						onStopwatchStop={onStopwatchStop}
						onError={showError}
					/>
				{/if}
			</div>

			<div class="flex flex-col gap-4 lg:gap-6">
				{#if summer.in_period}
					<SummerCommentCard
						ui={summer.ui}
						comment={summer.comment}
						todayScore={summer.today_score}
						scoreMax={summer.score_max}
						{ttsAvailable}
						onListen={() => {
							unlockSummerSpeech();
							void playComment();
						}}
					/>
					<SummerSpecialChallenge
						ui={summer.ui}
						challenges={summer.special_challenges}
						unlocked={summer.today_score?.unlocked ?? false}
						bonus={summer.today_score?.bonus ?? 0}
						onSet={(key, status) => setCheck(summer!.today, key, status)}
					/>
				{/if}
				<SummerSchoolStartItems ui={summer.ui} items={summer.school_start_items} onToggleFlag={toggleFlag} />
			</div>

			<div class="flex flex-col gap-4 lg:gap-6">
				<SummerHomeworkProgress
					ui={summer.ui}
					oneShot={summer.one_shot}
					choiceGroups={summer.choice_groups}
					daily={summer.daily_homework}
					progress={summer.progress}
					onToggleFlag={toggleFlag}
					onSetCount={setCount}
					onSetDecision={setDecision}
				/>
			</div>
		</div>

		{#if summer.rewards}
			<div class="mt-4 lg:mt-6">
				<SummerRewardChart ui={summer.ui} rewards={summer.rewards} history={summer.history} />
			</div>
		{/if}

		<div class="mt-4 lg:mt-6">
			<SummerHistoryGrid
				ui={summer.ui}
				history={summer.history}
				habits={summer.habits}
				daily={summer.daily_homework}
				streaks={summer.streaks}
				scoreMax={summer.score_max}
				onOpenDay={openDay}
			/>
		</div>

		<SummerCelebration ui={summer.ui} bind:this={celebration} />

		{#if mediaTimer.open}
			<SummerMediaTimerOverlay
				ui={summer.ui}
				timer={mediaTimer.timer}
				lastError={mediaTimer.lastError}
				onStart={() => mediaTimerStore.start()}
				onPause={() => mediaTimerStore.pause()}
				onClose={() => mediaTimerStore.closeOverlay()}
			/>
		{/if}

		{#if editDay}
			<SummerDayEditModal
				ui={summer.ui}
				day={editDay}
				habits={summer.habits}
				daily={summer.daily_homework}
				{anchorY}
				onSet={setCheck}
				onSetMeta={setMeta}
				onClose={() => (editDay = null)}
			/>
		{/if}
	{/if}
</div>

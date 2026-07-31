// 音声対話の「読み上げ」と「ウェイク確認音（earcon）」の iOS 解放を担う共有オーディオ。
//
// iOS Safari は audio.play() をユーザージェスチャー同期でしか許さず、しかも
// 「そのジェスチャー内で一度 play() を通した“同一の” HTMLAudioElement」しか
// 以後プログラムから鳴らせない（await を跨いだ play や、新しく作り直した new Audio()
// は再ブロックされる）。参考: assistant-brain/Knowledge/iOS Safari Quirks.md §2。
//
// ブリーフィング・服薬・到着通知の各プレイヤーは「永続要素 + ボタン unlock()」で
// これを守っているが、音声対話の SpeakQueue だけは往復ごとに new Audio() し、STT
// 完了後（＝ジェスチャー外）に unlock を呼んでいたため iOS で一度も鳴らなかった。
// ここに解放済みの永続要素を1つずつ持ち、SpeakQueue と playChime が使い回す。
//
// SILENT_WAV は iOS に弾かれない最小構成の無音 WAV（44byte・8kHz mono・16bit・0サンプル）。
// unlock の play() は await しない（0サンプル WAV の Promise が iOS Safari で resolve も
// reject もせず pending のまま固まる罠を避ける。iOS Safari Quirks.md §2 の注記）。

const SILENT_WAV =
	'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

let ttsEl: HTMLAudioElement | null = null;
let chimeEl: HTMLAudioElement | null = null;
let unlocked = false;

/** 読み上げ用の永続要素。SpeakQueue が src を差し替えて使い回す（毎回 new しない）。 */
export function getTtsAudio(): HTMLAudioElement {
	return (ttsEl ??= new Audio());
}

/** ウェイク確認音（G5→D6 の 2 音）用の永続要素。 */
export function getChimeAudio(): HTMLAudioElement {
	return (chimeEl ??= new Audio());
}

/** 既に iOS 解放済みか（状態表示・デバッグ用）。 */
export function isTtsUnlocked(): boolean {
	return unlocked;
}

/**
 * ユーザージェスチャー（クリック・pointerdown 等）の同期実行内で呼ぶ。
 * 共有要素に無音 WAV を1度通し、以後のプログラム再生を iOS に許可させる。
 * 2 回目以降は no-op（再生中かもしれない要素に触れない）。
 *
 * 重要: ジェスチャー外（ページ読込時の待受自動再開など）から呼ばない。無音 play() が
 * iOS にブロックされたまま unlocked フラグだけ立ち、後続の本物のタップでの再試行が
 * 効かなくなる。呼び出し側でジェスチャー起点であることを保証すること。
 */
export function unlockTtsAudio(): void {
	if (unlocked || typeof window === 'undefined') return;
	unlocked = true;
	for (const el of [getTtsAudio(), getChimeAudio()]) {
		// 再生中の要素には触れない: 待受自動再開（解放前）の読み上げが最初のタップで
		// この解放処理に鳴っている場合、SILENT_WAV で上書きすると文が途中で切れる。
		// 鳴っている＝その要素は既に再生可能なので、解放し直す必要もない。
		if (!el.paused) continue;
		try {
			el.src = SILENT_WAV;
			void el.play().catch(() => {});
		} catch {
			// 再生非対応の環境でも会話・待受そのものは継続させる
		}
	}
}

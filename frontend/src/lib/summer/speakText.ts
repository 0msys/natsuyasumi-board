// 読み上げ共通ヘルパー（がんばりコメント・きょうやること・管理画面の試聴）。
// iOS Safari はジェスチャー外の new Audio().play() をブロックするため、
// $lib/ttsAudio の解放済み永続要素を使い回す。
// VOICEVOX はオプション: ページが起動時に /api/tts/status を1回引いて
// setTtsAvailability() で反映し、使えないときは音声ボタンごと出さない。
// どの声で読むかは子どもごと（定義の voice.speaker）なので、合成には child を渡す。
import { api } from '$lib/api';
import { getTtsAudio, unlockTtsAudio } from '$lib/ttsAudio';
import { stripRuby } from './ruby';

let ttsAvailable = false;

/** ページ起動時に /api/tts/status の結果を反映する（音声ボタンの表示判断と再生ガードで共用）。 */
export function setTtsAvailability(available: boolean): void {
	ttsAvailable = available;
}

export function isTtsAvailable(): boolean {
	return ttsAvailable;
}

/** クリックハンドラの同期部で呼ぶ（iOS 解放。レイアウトの pointerdown 解放と二重でも無害）。 */
export function unlockSummerSpeech(): void {
	unlockTtsAudio();
}

/** テキストを VOICEVOX（/api/tts）で合成し、共有オーディオ要素で再生する。
 *  表示用のルビ記法「漢字《よみ》」は stripRuby でよみ（かな）へ畳んでから合成する（発音を確定）。
 *
 *  shouldPlay は「合成が返ってきた時点でもまだ鳴らしてよいか」。合成は数秒かかるので、
 *  その間に画面の選択が変わっていることがある。判定は blob を受け取ったあと・再生の直前に
 *  やらないと意味がない（再生はこの関数の中で起きるので、呼び出し側が await のあとで
 *  確かめても手遅れ＝もう鳴っている）。 */
async function synthesizeAndPlay(
	text: string,
	opts: { child?: string; speaker?: number },
	shouldPlay?: () => boolean
): Promise<void> {
	const blob = await api.ttsBlob(stripRuby(text), opts);
	if (shouldPlay && !shouldPlay()) return; // 追い越された合成は捨てる（鳴らさない）
	const url = URL.createObjectURL(blob);
	const el = getTtsAudio();
	el.pause();
	el.src = url;
	el.onended = () => URL.revokeObjectURL(url);
	await el.play();
}

/** 子どもページの読み上げ。その子の声（定義の voice.speaker）で鳴らす。
 *  VOICEVOX が使えないときは何もしない（無音縮退）。
 *
 *  子どもの切替（/?child=… のリンク）は同じルート内のクライアント遷移なので、
 *  合成を待つあいだに対象の子が変わりうる。呼び出し側は shouldPlay で
 *  「まだこの子のページか」を渡すこと——渡さないと、切り替えた先の画面で前の子あての
 *  褒めコメントや「きょうやること」が前の子の声で鳴る。 */
export async function speakSummerText(
	text: string,
	child: string,
	shouldPlay?: () => boolean
): Promise<void> {
	if (!ttsAvailable) return;
	await synthesizeAndPlay(text, { child }, shouldPlay);
}

/** 管理画面の試聴。子どもページ用の ttsAvailable ゲート（別ページで立てる旗）は通さない。
 *
 *  speaker を渡すと実在検査を迂回してその話者で鳴らす＝「まだ保存していない声」を試すための道。
 *  渡さないとサーバの既定の声（実在検査つき）になる。呼び出し側は「一覧から今えらんだ ID」の
 *  ときだけ渡すこと——一覧に無い ID をそのまま渡すと、子どもページでは既定の声へ落ちて鳴るのに
 *  試聴だけ 400 になり、「VOICEVOX がうごいていない」と誤って案内してしまう。
 *
 *  合成を待つあいだも こえ の選択は操作できるので、呼び出し側は shouldPlay で
 *  「まだこの こえ が選ばれているか」を渡すこと（渡さないと、選び直したあとに
 *  前の こえ が鳴って、画面の表示と聞こえる声が食い違う）。 */
export async function previewVoice(
	text: string,
	speaker?: number,
	shouldPlay?: () => boolean
): Promise<void> {
	unlockTtsAudio();
	await synthesizeAndPlay(text, speaker === undefined ? {} : { speaker }, shouldPlay);
}

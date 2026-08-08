// api が投げた失敗の解釈を、この1か所に集める。
//
// かつて同じ処理が2つあった（$lib/admin/apiError と 子どもページの showError）。
// ApiError（status / detail を構造で持つ）へ移したとき管理画面側だけが直り、
// 子どもページのほうは e.message を正規表現で読む古いままだったので、ひらがなの画面に
// 「400 まだ さきのひは かけないよ」と数字つきで出ていた。取り出しかたは1本にして、
// 違うのは「誰に見せる文言か」だけにする。
//
// contract から ApiError を取るのは $lib/api（index）を経由しないため。index は
// テストが丸ごと差し替えるので、そこに値を足すとモック下で undefined になる。
import { ApiError } from './contract';

/** HTTP ステータスを取り出す（判別できなければ null）. */
export function errorStatus(e: unknown): number | null {
	if (e instanceof ApiError) return e.status;
	const raw = e instanceof Error ? e.message : String(e);
	const m = raw.match(/ → (\d{3})( |$)/);
	return m ? Number(m[1]) : null;
}

/** 人に見せられる説明だけを取り出す（無ければ null）.
 *
 *  ApiError は message ではなく detail を見る（message には status が混ざる）。
 *  サーバの本文が `{"detail": "..."}` の JSON なら、その中身まで開く。
 *  正規表現の経路は、api を経由しない場所で投げられた素の Error のための保険。 */
function humanDetail(e: unknown): string | null {
	const raw = (
		e instanceof ApiError ? e.detail : e instanceof Error ? e.message : String(e)
	).trim();
	const m = raw.match(/\{.*\}$/s);
	if (m) {
		try {
			const detail = (JSON.parse(m[0]) as { detail?: unknown }).detail;
			if (typeof detail === 'string' && detail.trim()) return detail.trim();
		} catch {
			// JSON でなければ原文をそのまま使う
		}
	}
	return raw || null;
}

/** 管理画面（親）向けの文言。
 *
 *  空文字は絶対に返さないこと。エラーバナーはどれも `{#if error}` で出しているので、
 *  空を返した瞬間に失敗が画面から消える——削除や保存が黙って失敗し、親は成功したと
 *  思ってページを閉じる。本文が空の 500/502 は実際に起きる（client.ts は
 *  `res.text().catch(() => '')` を detail に入れる）ので、そのときは status を添える。 */
export function errorDetail(e: unknown): string {
	const detail = humanDetail(e);
	if (detail) return detail;
	const status = errorStatus(e);
	return status === null ? '失敗しました（理由が分かりませんでした）' : `失敗しました（${status}）`;
}

/** 文面が子どもあてに書かれたものか（status だけでは足りないぶんの用心）.
 *
 *  子ども向けの文言は、両実装とも ひらがな＋「」（）と数字だけで書いてある。
 *  英字が1文字でも混ざるものは大人あて——`必須キー 'period'`、`daily_homework[2]`、
 *  `この声（話者ID 3）では…`、プロキシの HTML、開けなかった JSON——なので落とす。
 *  逆に日本語が1文字も無いもの（Starlette が素の 500 で返す "Internal Server Error"）も
 *  子どもには読めない。 */
function looksChildFacing(text: string): boolean {
	if (/[A-Za-z]/.test(text)) return false;
	return /[぀-ヿ一-鿿]/.test(text);
}

/** 子どもページ向けの文言（ひらがな・数字なし）.
 *
 *  子どもあての文言を持つのは 400 だけ。これは両実装で揃っている——lite の
 *  `writeError()` も backend の `SummerWriteError` も 400 固定で、中身は
 *  「まだ さきのひは かけないよ」のような ひらがなの一言。
 *
 *  それ以外の status の detail は大人あてなので、日本語でも出さない:
 *    503 「「はな」の定義がありません」「はな（2026年）: 必須キー 'period' がありません」
 *    422 FastAPI の検証エラー（detail が配列）
 *    500 / 502 サーバやプロキシが素で返す本文
 *  api を通らない失敗（読み上げ再生の DOMException、通信断の `Failed to fetch`、
 *  保存が壊れたときの内部エラー）も同じ扱いで、決まった一言に畳む。 */
export function childErrorText(e: unknown): string {
	const detail = e instanceof ApiError && e.status === 400 ? humanDetail(e) : null;
	return detail && looksChildFacing(detail)
		? detail
		: 'うまく できなかったよ。もういちど やってみてね。';
}

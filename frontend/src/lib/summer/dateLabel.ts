// 日付の表示整形（純関数）。日付は常に「YYYY-MM-DD」文字列なので、
// Date を経由せず文字列のまま切り出す（タイムゾーンで前後の日にずれない）。
// 判定・計算はサーバ権威なので、ここは見た目だけを扱う。

/** 「2026-08-01」→「8/1」. */
export function mdOf(iso: string): string {
	return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

/**
 * 期間の見出し（「7/18〜8/31」）。日付は昇順で渡す前提（履歴グリッドの並び）。
 * 空なら空文字＝見出しを出さない。
 */
export function periodLabel(days: string[]): string {
	if (!days.length) return '';
	return `${mdOf(days[0])}〜${mdOf(days[days.length - 1])}`;
}

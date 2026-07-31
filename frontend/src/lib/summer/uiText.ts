// 画面の固定文言のプレースホルダ埋め（純関数）。
// 文言そのものは backend/app/summer/ui_text.py が単一真実源で、
// /api/summer/state の ui 欄に「その子の学年で開いた形」で載ってくる。
// プレースホルダ記法は backend の str.format と同じ「{name}」。
//
// 差し込む値がユーザ定義のラベル（それ自体がルビ記法）でも、
// 置換は1パスなので差し込んだ側が再走査されることはない。
// 埋めた結果は素の文字列なので、そのまま <Ruby text={...} /> に通せば
// ルビ付きで描ける（属性に使うときは stripRuby() を通す）。

export function fmt(template: string, params: Record<string, string | number>): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
		const value = params[key];
		return value === undefined ? whole : String(value);
	});
}

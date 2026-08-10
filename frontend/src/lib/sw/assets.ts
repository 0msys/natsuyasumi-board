// Service Worker が「必ず控えるもの／取れなくてもよいもの」に分ける、その判断だけ。
//
// service-worker.ts 本体に書かずにここへ出しているのは、`$service-worker` が
// Service Worker のビルドの中でしか読めず、ふつうのテストから触れないため。
// 判断の中身をここに置けば、並び順に依存していないことをテストで固定できる。

type CacheTargets = {
	/** その版の JS と CSS（欠けると画面が組み立たない） */
	build: readonly string[];
	/** static/ に置いたもの。アイコン・manifest など */
	files: readonly string[];
	/** prerender で出したページ。**並び順は決まっていない** */
	prerendered: readonly string[];
	/** サブパス（GitHub Pages のリポジトリ名部分）。直下配信なら空文字 */
	base: string;
	/** 動的ルートの入れ物（404.html）。ローカルの preview では配られない */
	fallback: string;
};

/**
 * 圏外で1ページ開くための HTML の入れ物（サブパス直下＝ / のページ）を選ぶ。
 * 名指しで見つからなければ undefined を返す（ほかのページで代用しない）。
 *
 * `prerendered[0]` で済ませてはいけない。この配列の並び順は SvelteKit の都合
 * （prerender の巡回順）で決まるもので、ルートが先頭に来ると約束されてはいない。
 * 並びが変わって /admin が先頭になると、「必ず控える」側に入るのが admin だけになり、
 * ルートの入れ物は「取れたら控える」側へ落ちる。電波の悪いところで入れ直すと、
 * その取りこぼしを抱えたまま install が成功し、activate が完全だった前の版の
 * キャッシュを消す——ホーム画面から開いても出せる HTML が1枚も無い状態になる。
 * install が addAll と allSettled を分けているのは、まさにそれを防ぐためなので、
 * 何を必ず控えるかは並び順ではなく名指しで決める。
 *
 * 見つからないときに先頭で代用するのも同じ理由でやめる。`prerendered` には prerender した
 * **endpoint**（JSON など）も混ざりうるので、先頭が HTML だとは限らない。圏外の navigate に
 * JSON を返せば画面は出ず、それでも install は成功して前の版のキャッシュが消える。
 * 「代用が無い」ことをそのまま返し、install を失敗させる判断は splitCacheTargets に任せる。
 */
export function pickShell(prerendered: readonly string[], base: string): string | undefined {
	// SvelteKit がルートページに付ける名前は `${base}/`。将来これが末尾の / の無い
	// `${base}` になっても拾えるよう、両方見る（base が空文字のときは前者だけ）。
	const roots = base ? [`${base}/`, base] : [`${base}/`];
	return roots.find((root) => prerendered.includes(root));
}

/**
 * install で控える先を2つに分ける。
 *
 * essential … addAll で「ぜんぶ揃ったときだけ」入れる。1本でも欠けたら install ごと失敗し、
 *             前の版のキャッシュがそのまま残るほうが、中途半端な控えより安全。
 * optional  … 無くても開けるもの。取れなくても install は通す。
 */
export function splitCacheTargets(targets: CacheTargets): {
	/** 圏外のときに navigate へ返す入れ物。fetch 側もこれを見る（別々に決めない） */
	shell: string | undefined;
	essential: string[];
	optional: string[];
	/** true なら、何も控えずに install ごと失敗させる（理由は下） */
	failClosed: boolean;
} {
	const shell = pickShell(targets.prerendered, targets.base);
	const essential = shell ? [...targets.build, shell] : [...targets.build];
	// 残りの prerendered を slice(1) で拾ってはいけない（入れ物が先頭とは限らない＝
	// 先頭のページが optional からも漏れて、どこにも控えられなくなる）。
	// 全部並べてから入れ物だけ除く。重複はここで潰す（同じ URL を2回取りに行かない）。
	const optional = [
		...new Set([...targets.files, ...targets.prerendered, targets.fallback])
	].filter((url) => url !== shell);
	// その版の JS/CSS はあるのに入れ物が1枚も無い＝控えても圏外では何も出せない。
	// それでも addAll は成功してしまうので、放っておくと新しい Service Worker が
	// activate まで進み、**完全だった前の版のキャッシュを消す**。更新前より悪くなる。
	// ここで install ごと失敗させれば、前の版がそのまま残って動き続ける。
	//
	// build が空のときだけは通す。それは vite dev（`bun run dev:lite`）で、$service-worker の
	// build も prerendered も空になる場合＝そもそも圏外で出す中身が無く、守るべき前の版も
	// 無い。ここで失敗させると、開発中は毎回 install が落ちるだけになる。
	const failClosed = !shell && targets.build.length > 0;
	return { shell, essential, optional, failClosed };
}

// JSON をファイルとして保存させる。
//
// api を通らないネットワーク経路（<a href="/api/..." download>）を残さないための置き換え。
// lite（GitHub Pages）にはそんな URL が無いので、中身はどちらの実装でも api から受け取って
// ここで Blob に組み立てる。
//
// 呼ぶ側へ: この関数が戻ったことは「ブラウザに渡した」までしか意味しない。ファイルが端末に
// 残ったかは、どのブラウザも教えてくれない（iPhone の共有シートで取り消しても、ダウンロードが
// 止められても、例外もイベントも出ない）。「ほぞんしました」と言い切る文言や、催促の基準を
// 進める書き込みを、この戻りにぶら下げないこと。
//
// 返す url は、親がもう一度**自分で**押せる本物のリンクに使う。こちらが仕込んだクリックと
// 違って、親が押したものはブラウザに落とされない。使い終わったら release() すること——
// 中身（記録まるごとの写し）を抱えたままになる。呼ぶ側は「新しく書き出すとき」
// 「片づいたとき」「画面を離れるとき」の3か所で release() する。型では強制できないので、
// この3点セットで覚えること。
export type DownloadHandle = {
	url: string;
	filename: string;
	/** url を解放する。2回呼んでよい。 */
	release(): void;
};

export function downloadJson(filename: string, data: unknown): DownloadHandle {
	// 組み立てで転ぶことがある（記録が大きいと JSON.stringify が落ちる）。握りつぶさない
	// ——投げれば、呼んだ側が「出せた」と扱わずに済む。
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
	);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	// 画面に入れてから押す。どこにも属していない <a> のクリックを無視するブラウザがある
	// ——見た目は何も起きず、例外も出ず、click は document まで上がってこないので誰も
	// 気づけない。いちばん静かな壊れかたなので、ここは規格どおりに押す。
	a.style.display = 'none';
	document.body.append(a);
	a.click();
	// 片づけは次の番まで待つ。click() は同期なので外して問題ないはずだが、ここは
	// 「押したのに何も起きない」を潰しにきている場所なので、確かめようのない賭けを足さない。
	setTimeout(() => a.remove(), 0);
	let released = false;
	return {
		url,
		filename,
		release() {
			if (released) return;
			released = true;
			URL.revokeObjectURL(url);
		}
	};
}

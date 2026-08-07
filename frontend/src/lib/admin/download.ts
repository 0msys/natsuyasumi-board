// JSON をファイルとして保存させる。
//
// api を通らないネットワーク経路（<a href="/api/..." download>）を残さないための置き換え。
// lite（GitHub Pages）にはそんな URL が無いので、中身はどちらの実装でも api から受け取って
// ここで Blob に組み立てる。
export function downloadJson(filename: string, data: unknown): void {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
	);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	// click() は同期なので、次のタスクまで待てば取り消して問題ない。
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

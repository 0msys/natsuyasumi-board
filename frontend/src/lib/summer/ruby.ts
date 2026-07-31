// 夏休みページのふりがな（ルビ）共通処理。
// 表示ラベルは「漢字《よみ》」の青空文庫式ルビ記法で書かれる（定義ドキュメント由来）。
//   - 《》(U+300A/300B) は直前の連続する漢字の最長ランに付く（例 朝《あさ》・食《た》べた・国語《こくご》）
//   - ｜(U+FF5C) で基底の開始を明示できる（例 お｜手《て》つだい）
//   - 対応しない括弧はそのまま文字として扱う（寛容パース＝壊さない）
// 子どもが自分で読めるよう「その学年までの配当漢字＋総ルビ」で書き、まだ習わない字はかなで書く方針。

const KANJI = /[㐀-鿿々〆〇ヶ]/; // 基底＝漢字の連続ラン（教育漢字は U+4E00-9FFF に収まるが広めに取る）

export type RubySegment = { kind: 'text'; text: string } | { kind: 'ruby'; base: string; rt: string };

/** 「漢字《よみ》」を含む文字列を、表示用セグメント列に分解する（純関数・寛容）。 */
export function parseRuby(input: string): RubySegment[] {
	const segs: RubySegment[] = [];
	let buf = ''; // まだ確定出力していないプレーンテキスト
	let explicitStart: number | null = null; // ｜ で明示された基底開始位置（buf 内インデックス）
	let i = 0;
	const pushText = (s: string) => {
		if (!s) return;
		const last = segs[segs.length - 1];
		if (last && last.kind === 'text') last.text += s;
		else segs.push({ kind: 'text', text: s });
	};
	while (i < input.length) {
		const ch = input[i];
		if (ch === '｜') {
			explicitStart = buf.length; // 以降 buf に積む分が基底
			i++;
			continue;
		}
		if (ch === '《') {
			const close = input.indexOf('》', i + 1);
			if (close === -1) {
				buf += ch; // 閉じが無い＝リテラル
				i++;
				continue;
			}
			const rt = input.slice(i + 1, close);
			let baseStart: number;
			if (explicitStart !== null) {
				baseStart = explicitStart;
			} else {
				baseStart = buf.length;
				while (baseStart > 0 && KANJI.test(buf[baseStart - 1])) baseStart--;
			}
			const base = buf.slice(baseStart);
			pushText(buf.slice(0, baseStart));
			if (base) {
				segs.push({ kind: 'ruby', base, rt });
			} else {
				// 基底が無い（直前が漢字でない・｜直後が《）＝ルビにできないのでリテラル表示
				pushText('《' + rt + '》');
			}
			buf = '';
			explicitStart = null;
			i = close + 1;
			continue;
		}
		buf += ch; // 「》」単独もここでリテラルとして積まれる
		i++;
	}
	pushText(buf);
	return segs;
}

const ESCAPE: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPE[c]);

/**
 * ルビ記法を <ruby>基底<rt>よみ</rt></ruby> の HTML 断片にする。
 * 基底・よみ・非ルビ部を全てエスケープし、こちらが組む <ruby>/<rt> だけを素の HTML にする＝XSS 安全。
 * （Ruby.svelte はセグメント直描画で {@html} 不要。この関数は非 Svelte 経路・テスト用の予備。）
 */
export function renderRubyHtml(text: string): string {
	return parseRuby(text ?? '')
		.map((seg) =>
			seg.kind === 'text'
				? escapeHtml(seg.text)
				: `<ruby>${escapeHtml(seg.base)}<rt>${escapeHtml(seg.rt)}</rt></ruby>`
		)
		.join('');
}

/**
 * ルビ記法を除去して純テキストにする（属性 title/aria と TTS 用）。
 * 「基底《よみ》」は "よみ"（かな）へ畳む＝読み上げ発音を確定させ、属性も子どもが読める。
 */
export function stripRuby(text: string): string {
	return parseRuby(text ?? '')
		.map((seg) => (seg.kind === 'text' ? seg.text : seg.rt))
		.join('');
}

// CRC-32/IEEE。褒めメッセージのバリアント選択にだけ使う。
//
// バックエンドが zlib.crc32 を使っているのは「同じ子・同じ日なら必ず同じ文」を
// 作るためで、暗号用途ではない（Python 組み込みの hash() は起動ごとに変わるので使えない）。
// 同じ文を選ぶには、こちらも同じ値を出す必要がある。

const TABLE = /* @__PURE__ */ (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

/** 文字列（UTF-8 バイト列）の CRC-32。zlib.crc32 と同じ値を返す。 */
export function crc32(text: string): number {
	const bytes = new TextEncoder().encode(text);
	let c = 0xffffffff;
	for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

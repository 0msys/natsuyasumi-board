// マニュアルが「どちらの版の説明を出すか」。
//
// __NYB_LITE__ は vite.config.ts の define で埋める定数で、素の識別子として存在するのは
// ビルド後だけ。bun test には define が無いので、裸で参照すると ReferenceError になり
// このモジュールを読んだテストファイルが丸ごと落ちる。typeof でくるむと両方で動く:
//   - bun test  … 未定義 → 'undefined' → docker とみなす（edition.test.ts で固定）
//   - vite      … 識別子が字句置換されて `typeof true !== 'undefined'` になり、定数畳み込み
//                 で消える（＝lite バンドルに分岐は残らない）
// このガードを外して裸の参照に戻すと edition.test.ts が落ちる。意図的な番人なので外さないこと。

export type Edition = 'lite' | 'docker';

export const EDITIONS: { id: Edition; label: string }[] = [
	{ id: 'lite', label: 'lite版' },
	{ id: 'docker', label: 'docker版' }
];

/** いま動いている版。define の無い環境（bun test）では docker とみなす。 */
export function runningEdition(): Edition {
	return typeof __NYB_LITE__ !== 'undefined' && __NYB_LITE__ ? 'lite' : 'docker';
}

/** その版だけに付ける見出し（EditionNote の帯）。 */
export function editionOnlyLabel(edition: Edition): string {
	return edition === 'lite' ? 'lite版だけ' : 'docker版だけ';
}

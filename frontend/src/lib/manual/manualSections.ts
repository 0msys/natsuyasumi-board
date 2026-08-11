// マニュアルの節の定義。もくじと各節の <h2> は、どちらもここだけを見る。
// $lib/admin/sectionDefs.ts と同じ形（id と label の並び＋引き）にそろえている。
//
// 1行 = 1ファイル（$lib/manual/sections/*.svelte）で、routes/manual/page.test.ts が
// 「この並びぶんの節が実際に描かれ、もくじも同じ順で同じ数だけリンクを持つ」ことを見る。
// 節を足すときは、ここに1行足して同名のコンポーネントを作り、+page.svelte で描くこと。

export type ManualSectionId =
	| 'overview'
	| 'setup'
	| 'daily'
	| 'progress'
	| 'history'
	| 'admin'
	| 'data'
	| 'trouble';

export const MANUAL_SECTIONS: { id: ManualSectionId; label: string }[] = [
	{ id: 'overview', label: 'このアプリでできること' },
	{ id: 'setup', label: 'さいしょの準備（子どもを登録する）' },
	{ id: 'daily', label: '毎日つかう画面 — 今日の記録' },
	{ id: 'progress', label: '進みぐあいとごほうびを見る' },
	{ id: 'history', label: '前の日の記録を直す' },
	{ id: 'admin', label: '設定を変える' },
	{ id: 'data', label: 'データの保存とバックアップ' },
	{ id: 'trouble', label: 'こまったときは' }
];

export function manualSectionLabel(id: ManualSectionId): string {
	return MANUAL_SECTIONS.find((s) => s.id === id)?.label ?? id;
}

// 仕様書（docs/spec/screens/manual.md）と、実際の節の並びがそろっていることを見る。
//
// マニュアルは「コード → 仕様書 → 本文」の3点を同時に動かす作りなので、節を足したり
// 名前を変えたりしたときに仕様書だけ古いまま残りやすい。実際、節の表と件数表記は
// 人手のレビューで2度ずれを指摘されている。数え違いは読んでも気づきにくいので機械で拾う。
import { expect, test } from 'bun:test';
import { MANUAL_SECTIONS } from '$lib/manual/manualSections';

const ROOT = new URL('../../../..', import.meta.url).pathname; // リポジトリのルート
const SPEC = 'docs/spec/screens/manual.md';

/** 「## 節の構成」の表の1列目を、書いてある順に取り出す。 */
function sectionTableLabels(md: string): string[] {
	const from = md.indexOf('## 節の構成');
	if (from < 0) return [];
	const labels: string[] = [];
	for (const line of md.slice(from).split('\n')) {
		if (!line.startsWith('|')) {
			if (labels.length) break; // 表が終わった
			continue; // 表が始まる前
		}
		const first = line.split('|')[1]?.trim() ?? '';
		if (first === '節' || /^-+$/.test(first)) continue; // 見出しと区切り
		labels.push(first);
	}
	return labels;
}

test('仕様書の節の表が、実際の節と同じ並びである', async () => {
	const md = await Bun.file(ROOT + SPEC).text();

	expect(
		sectionTableLabels(md),
		`${SPEC} の「節の構成」を manualSections.ts に合わせること（節を足したら行も足す）`
	).toEqual(MANUAL_SECTIONS.map((s) => s.label));
});

test('仕様書の節の件数表記が、実際の節数と合っている', async () => {
	const md = await Bun.file(ROOT + SPEC).text();
	const n = MANUAL_SECTIONS.length;

	// 「N つの節」以外の数え方で節数を書かないこと（書くならこの番人を足すこと）。
	const stated = [...(md.match(/\d+つの節/g) ?? [])];
	expect(stated.length, `${SPEC} に「Nつの節」の記述が要る`).toBeGreaterThan(0);
	expect([...new Set(stated)], `${SPEC} の節数を ${n} に直すこと`).toEqual([`${n}つの節`]);
});

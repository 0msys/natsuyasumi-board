// 圏外で開けることの土台。prerendered の並び順が変わっても、控える先の分けかたが
// 変わらないことをここで固定する（並び順に寄りかかっていたのが issue #7）。
import { describe, expect, it } from 'bun:test';
import { pickShell, splitCacheTargets } from './assets';

const BASE = '/natsuyasumi-board';
const BUILD = [`${BASE}/_app/immutable/entry/app.js`, `${BASE}/_app/immutable/assets/0.css`];
const FILES = [`${BASE}/manifest.webmanifest`, `${BASE}/icons/icon-192.png`];
const FALLBACK = `${BASE}/404.html`;

/** いまのビルドが出している並び（ルートが先頭）。 */
const PRERENDERED = [`${BASE}/`, `${BASE}/admin`, `${BASE}/admin/new`];
/** 並びが変わった場合（ルートが先頭ではない）。 */
const SHUFFLED = [`${BASE}/admin`, `${BASE}/admin/new`, `${BASE}/`];

const split = (prerendered: readonly string[], base = BASE) =>
	splitCacheTargets({ build: BUILD, files: FILES, prerendered, base, fallback: FALLBACK });

describe('圏外用の入れ物を選ぶ', () => {
	it('サブパス直下のページを名指しで選ぶ（先頭かどうかは見ない）', () => {
		expect(pickShell(PRERENDERED, BASE)).toBe(`${BASE}/`);
		expect(pickShell(SHUFFLED, BASE)).toBe(`${BASE}/`);
	});

	it('サブパス無しで配信する版でも選べる', () => {
		expect(pickShell(['/admin', '/'], '')).toBe('/');
	});

	it('末尾の / が付かない名前で出ていても拾う', () => {
		expect(pickShell([`${BASE}/admin`, BASE], BASE)).toBe(BASE);
	});

	it('直下のページが見つからなければ先頭で代用する（何も控えないよりはよい）', () => {
		expect(pickShell([`${BASE}/admin`], BASE)).toBe(`${BASE}/admin`);
	});

	it('prerender したページが1枚も無ければ undefined', () => {
		expect(pickShell([], BASE)).toBeUndefined();
	});
});

describe('install で控える先の分けかた', () => {
	it('必ず控えるのは、その版の JS/CSS と入れ物1枚だけ', () => {
		expect(split(PRERENDERED).essential).toEqual([...BUILD, `${BASE}/`]);
	});

	it('並びが変わっても、必ず控えるのは同じ（admin に入れ替わらない）', () => {
		expect(split(SHUFFLED).essential).toEqual([...BUILD, `${BASE}/`]);
	});

	it('入れ物以外の prerendered は、並びに関わらず全部 optional に残る', () => {
		// slice(1) で拾っていたころは、入れ物が先頭でないと先頭のページが
		// essential にも optional にも入らず、どこにも控えられなかった。
		for (const prerendered of [PRERENDERED, SHUFFLED]) {
			const { optional } = split(prerendered);
			expect(optional).toContain(`${BASE}/admin`);
			expect(optional).toContain(`${BASE}/admin/new`);
			expect(optional).not.toContain(`${BASE}/`);
		}
	});

	it('アイコン類と 404.html は optional（preview で配られなくても install を通す）', () => {
		const { optional } = split(PRERENDERED);
		for (const file of FILES) expect(optional).toContain(file);
		expect(optional).toContain(FALLBACK);
		expect(split(PRERENDERED).essential).not.toContain(FALLBACK);
	});

	it('同じ URL は1回しか取りに行かない', () => {
		const { optional } = split([...PRERENDERED, FALLBACK]);
		expect(optional.length).toBe(new Set(optional).size);
	});

	it('prerender したページが無ければ、必ず控えるのは JS/CSS だけ', () => {
		const { shell, essential, optional } = split([]);
		expect(shell).toBeUndefined();
		expect(essential).toEqual([...BUILD]);
		expect(optional).toEqual([...FILES, FALLBACK]);
	});

	it('fetch 側が使う入れ物と、控えた入れ物は同じもの', () => {
		const { shell, essential } = split(SHUFFLED);
		expect(shell).toBeDefined();
		expect(essential).toContain(shell as string);
	});
});

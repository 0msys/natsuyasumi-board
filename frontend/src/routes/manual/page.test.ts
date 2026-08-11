// マニュアル画面の骨格を固定する。
//
// 本文そのものは検査しない（文章を直すたびにテストが落ちるのは意味がない）。見るのは
// 「読み手が迷子にならないための仕掛け」が生きているかの3点:
//   - もくじのリンクと、実際に描かれている節が1対1で対応している
//   - 版の切り替えが、ほんとうに本文を差し替えている（隠しているだけではない）
//   - 切り替えがラジオグループとして読まれる（見出しだけの飾りになっていない）
//
// api は使わないページなので apiMock は入れない。入れたくなったら、それ自体が
// 「マニュアルがサーバに触りはじめた」というバグの合図（lite の grep 番人に引っかかる）。
import { beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { MANUAL_SECTIONS } from '$lib/manual/manualSections';
import '../../test-support/appMocks'; // ページが $app/paths（resolve）を使う

const Page = (await import('./+page.svelte')).default;

/** その版でしか出ない文言（本文から1つずつ選ぶ）. */
const LITE_ONLY = 'ほぞんできた';
const DOCKER_ONLY = 'VOICEVOX';

const selectEdition = async (label: string) =>
	await fireEvent.click(screen.getByRole('radio', { name: label }));

/** その文言が本文に何か所あるか（queryByText は複数当たると投げるので数で見る）. */
const mentions = (text: string) => screen.queryAllByText(text, { exact: false }).length;

beforeEach(() => {
	cleanup();
});

describe('マニュアル画面', () => {
	it('見出しを出す', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1, name: 'つかいかた' })).toBeTruthy();
	});

	it('もくじのリンクと節が1対1で対応する', () => {
		const { container } = render(Page);

		// もくじのリンク（#で始まる href）を並び順に取り出す。
		const toc = container.querySelector('#manual-toc');
		expect(toc).toBeTruthy();
		const hrefs = Array.from(toc!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(MANUAL_SECTIONS.map((s) => `#${s.id}`));

		// 飛び先が実在し、その節の見出しがもくじの文字と一致する。
		for (const s of MANUAL_SECTIONS) {
			const section = container.querySelector(`#${s.id}`);
			expect(section, `#${s.id} の節が描かれていない`).toBeTruthy();
			expect(section!.querySelector('h2')?.textContent?.trim()).toBe(s.label);
		}
	});

	it('版の切り替えがラジオグループとして読まれる', () => {
		render(Page);
		expect(screen.getByRole('group', { name: 'どちらの版の説明を読むか' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'lite版' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'docker版' })).toBeTruthy();
	});

	it('既定はいま動いている版（bun test では docker）', () => {
		render(Page);
		expect((screen.getByRole('radio', { name: 'docker版' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole('radio', { name: 'lite版' }) as HTMLInputElement).checked).toBe(false);
	});

	it('lite へ切り替えると、docker だけの説明が DOM から消える', async () => {
		render(Page);
		expect(mentions(DOCKER_ONLY)).toBeGreaterThan(0);

		await selectEdition('lite版');

		// 非表示ではなく取り除かれていること（読み上げや検索に残ると版を誤解させる）。
		expect(mentions(DOCKER_ONLY)).toBe(0);
		expect(mentions(LITE_ONLY)).toBeGreaterThan(0);
	});

	it('docker へ戻すと、lite だけの説明が DOM から消える', async () => {
		render(Page);
		await selectEdition('lite版');
		await selectEdition('docker版');

		expect(mentions(LITE_ONLY)).toBe(0);
		expect(mentions(DOCKER_ONLY)).toBeGreaterThan(0);
	});

	it('こまったときの質問は、版を切り替えても見出しが残る', () => {
		// <details> の開閉は happy-dom の実装が不完全なので、質問文が描けていることだけ見る。
		render(Page);
		expect(screen.getByText('記録が消えてしまった')).toBeTruthy();
	});
});

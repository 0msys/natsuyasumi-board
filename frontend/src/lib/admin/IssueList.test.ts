// 検証結果から該当タブへ飛ぶリンクも、編集中の年を連れて行く。
// （タブバーと同じ落とし穴: `?section=` だけ書くとクエリが置き換わって year が落ち、
//  エラーを直しに飛んだ先が別の年の画面になる）
import { beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/svelte';

const IssueList = (await import('./IssueList.svelte')).default;

// screen は document 全体を見るので、描く前に前のテストの DOM を畳む（bun では自動 cleanup が効かない）
beforeEach(() => cleanup());

const errors = [{ path: '/habits/0/label', code: 'kanji', message: 'ならっていない漢字です' }];
const warnings = [{ path: '/period', code: 'mid_period_add', message: 'きかんの途中です' }];

describe('IssueList のタブリンク', () => {
	it('編集中の年を付ける', () => {
		render(IssueList, { props: { errors, warnings: [], year: 2027 } });
		expect(screen.getByRole('link', { name: 'せいかつ' }).getAttribute('href')).toBe(
			'?section=habits&year=2027'
		);
	});

	it('警告のリンクも同じ（きほんタブへ）', () => {
		render(IssueList, { props: { errors: [], warnings, year: 2027 } });
		expect(screen.getByRole('link', { name: 'きほん' }).getAttribute('href')).toBe(
			'?section=basic&year=2027'
		);
	});

	it('年が分からなければ付けない（1年しか無い子）', () => {
		render(IssueList, { props: { errors, warnings: [], year: null } });
		expect(screen.getByRole('link', { name: 'せいかつ' }).getAttribute('href')).toBe(
			'?section=habits'
		);
	});
});

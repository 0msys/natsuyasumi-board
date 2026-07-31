// タブのリンクと離脱ガードの判定。年をまたいで定義を持てるようになってからの回帰。
import { describe, expect, it } from 'bun:test';
import { isSameEditTarget, sectionHref } from './sectionDefs';

const url = (s: string) => new URL(s, 'http://localhost');

describe('sectionHref', () => {
	it('編集中の年をクエリに残す（落とすと別の年の画面に化ける）', () => {
		expect(sectionHref('habits', 2027)).toBe('?section=habits&year=2027');
	});

	it('年が分からないときは付けない（サーバ既定の年に任せる）', () => {
		expect(sectionHref('habits', null)).toBe('?section=habits');
		expect(sectionHref('habits', undefined)).toBe('?section=habits');
		expect(sectionHref('habits', 0)).toBe('?section=habits'); // 未初期化のドラフト
	});
});

describe('isSameEditTarget', () => {
	it('同じ年のタブ切替は素通し（未保存でも聞かない）', () => {
		const from = url('/admin/はな?section=basic&year=2027');
		const to = url('/admin/はな?section=habits&year=2027');
		expect(isSameEditTarget(from, to, 2027)).toBe(true);
	});

	it('年が変わる遷移は同じパスでも別扱い（ドラフトが作り直されるため）', () => {
		const from = url('/admin/はな?section=basic&year=2027');
		const to = url('/admin/はな?section=basic&year=2026');
		expect(isSameEditTarget(from, to, 2027)).toBe(false);
	});

	it('どちらも年を書いていなければ同じ（1年しか無い子の URL）', () => {
		expect(isSameEditTarget(url('/admin/はな'), url('/admin/はな?section=habits'), 2026)).toBe(true);
	});

	it('年ありから年なしへ戻るのは別扱い（戻るボタン・手打ちの URL）', () => {
		// 年なしの行き先はサーバ既定の年に着く＝いま開いている年とは限らない。
		// ここを素通しにすると、戻るボタンひとつで未保存の編集が黙って消える。
		expect(isSameEditTarget(url('/admin/はな?year=2027'), url('/admin/はな'), 2027)).toBe(false);
		expect(
			isSameEditTarget(url('/admin/はな?section=habits&year=2027'), url('/admin/はな'), 2027)
		).toBe(false);
	});

	it('年なしから、いま開いている年へのリンクは同じ（タブを押しただけ）', () => {
		expect(isSameEditTarget(url('/admin/はな'), url('/admin/はな?section=habits&year=2026'), 2026)).toBe(
			true
		);
	});

	it('別の子・一覧・子どもページへの移動は別扱い', () => {
		expect(isSameEditTarget(url('/admin/はな'), url('/admin/そら'), 2026)).toBe(false);
		expect(isSameEditTarget(url('/admin/はな'), url('/admin'), 2026)).toBe(false);
		expect(isSameEditTarget(url('/admin/はな'), url('/'), 2026)).toBe(false);
	});

	it('遷移元・先が無いとき（外部離脱）は別扱い', () => {
		expect(isSameEditTarget(undefined, url('/admin/はな'), 2026)).toBe(false);
		expect(isSameEditTarget(url('/admin/はな'), null, 2026)).toBe(false);
	});
});

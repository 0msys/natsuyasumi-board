import { describe, expect, it } from 'bun:test';
import { nextSchoolStartItem } from './schoolStart';

const item = (key: string, due: string, done = false) => ({ key, label: key, due, done });

describe('nextSchoolStartItem', () => {
	it('まだの項目のうち期日がいちばん近いものを返す', () => {
		const items = [item('a', '2026-09-01'), item('b', '2026-08-31'), item('c', '2026-09-03')];
		expect(nextSchoolStartItem(items)?.key).toBe('b');
	});

	it('できた項目は飛ばす（期日が近くても出さない）', () => {
		const items = [item('a', '2026-08-31', true), item('b', '2026-09-01')];
		expect(nextSchoolStartItem(items)?.key).toBe('b');
	});

	it('同じ期日は定義の並び順で先のものを返す', () => {
		const items = [item('a', '2026-09-01'), item('b', '2026-09-01')];
		expect(nextSchoolStartItem(items)?.key).toBe('a');
	});

	it('期日を過ぎた未了項目はいちばん前に出る（隠さない）', () => {
		const items = [item('a', '2026-09-01'), item('old', '2026-07-01')];
		expect(nextSchoolStartItem(items)?.key).toBe('old');
	});

	it('全部できていれば null（ヒントを出さない）', () => {
		const items = [item('a', '2026-08-31', true), item('b', '2026-09-01', true)];
		expect(nextSchoolStartItem(items)).toBeNull();
	});

	it('項目が無ければ null', () => {
		expect(nextSchoolStartItem([])).toBeNull();
	});
});

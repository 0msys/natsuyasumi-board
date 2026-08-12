// 年ずらしが「日付に見えるゴミ」を返さないことの錠。
//
// 形を確かめずに年・月・日を切り出していたころは shiftYear('', 1) が '0001-00--1'、
// shiftYear('abc', 1) が '0NaN-00--1' を返し、その値が lite の来年ぶんの定義に
// そのまま書き込まれていた（Docker 版は同じ入力で 500 になっていた）。
// backend/tests/test_admin_store.py の test_読めない日付の年ずらしは422で止まる と対になる。
import { describe, expect, it } from 'bun:test';
import { shiftYear } from './dates';

describe('shiftYear', () => {
	it('読めない値は、日付を組み立てずに投げる', () => {
		// '2026-02-30' と '2026-13-01' は桁だけ合っている（繰り上げで通してはいけない）
		for (const bad of ['', 'abc', '2026-13-01', '2026-02-30', '0001-00--1', '2026/07/21']) {
			expect(() => shiftYear(bad, 1)).toThrow();
		}
	});

	it('うるう日は、その年に無ければ前の日へ丸める', () => {
		expect(shiftYear('2024-02-29', 1)).toBe('2025-02-28');
		expect(shiftYear('2024-02-29', 4)).toBe('2028-02-29'); // 4年後はうるう年なのでそのまま
	});

	it('ふつうの日は月日を変えない', () => {
		expect(shiftYear('2026-07-21', 1)).toBe('2027-07-21');
		expect(shiftYear('2026-07-21', -1)).toBe('2025-07-21');
	});
});

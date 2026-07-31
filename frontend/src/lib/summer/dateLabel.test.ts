import { describe, expect, it } from 'bun:test';
import { mdOf, periodLabel } from './dateLabel';

describe('mdOf', () => {
	it('先頭の0を落とした M/D にする', () => {
		expect(mdOf('2026-08-01')).toBe('8/1');
		expect(mdOf('2026-07-18')).toBe('7/18');
		expect(mdOf('2026-12-25')).toBe('12/25');
	});
});

describe('periodLabel', () => {
	it('最初の日と最後の日をつなぐ', () => {
		expect(periodLabel(['2026-07-18', '2026-07-19', '2026-08-31'])).toBe('7/18〜8/31');
	});

	it('1日だけでも同じ日をつなぐ（期間が1日の定義でも壊れない）', () => {
		expect(periodLabel(['2026-08-01'])).toBe('8/1〜8/1');
	});

	it('空なら空文字（履歴が無いときに見出しを出さない）', () => {
		expect(periodLabel([])).toBe('');
	});
});

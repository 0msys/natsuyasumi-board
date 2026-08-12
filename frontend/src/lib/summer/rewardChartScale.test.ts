import { describe, expect, it } from 'bun:test';
import { chartTopValue } from './rewardChartScale';

const rewards = (maxTotal: number, thresholds: number[]) => ({
	max_total: maxTotal,
	ranks: thresholds.map((threshold, i) => ({
		key: String(i),
		label: `ランク${i}`,
		avg: 0,
		threshold,
		prize: null,
		achieved: false
	}))
});

describe('chartTopValue', () => {
	it('ふつうは max_total がそのまま上端になる', () => {
		// 標準テンプレート（チャレンジ2件・42日）＝上限 150×42
		expect(chartTopValue(rewards(6300, [2520, 3780, 4620, 5460]))).toBe(6300);
	});

	it('届かないランクがあれば、そのしきい値まで上端を伸ばす', () => {
		// issue #28 の実値: 上限 150×42=6300 に対して avg180 の S は 7560
		expect(chartTopValue(rewards(6300, [3360, 4200, 6300, 7560]))).toBe(7560);
	});

	it('max_total が 0 でも 1 を返す（0除算でグラフごと消えない）', () => {
		expect(chartTopValue(rewards(0, []))).toBe(1);
	});

	it('ごほうびが1つも無くても max_total を返す', () => {
		expect(chartTopValue(rewards(6300, []))).toBe(6300);
	});

	it('どのしきい値もプロット領域に収まる（帯もラベルも枠外へ出ない）', () => {
		// y = MT + plotH × (1 - threshold/top) なので、1 - threshold/top が 0..1 を
		// 外れた瞬間に「帯の高さ0」「ラベルが viewBox 外」「ペース点線が突き抜け」が起きる。
		const r = rewards(6300, [3360, 4200, 6300, 7560]);
		const top = chartTopValue(r);
		for (const rank of r.ranks) {
			const ratio = 1 - rank.threshold / top;
			expect(ratio, `しきい値 ${rank.threshold} が描画領域の外`).toBeGreaterThanOrEqual(0);
			expect(ratio, `しきい値 ${rank.threshold} が描画領域の外`).toBeLessThanOrEqual(1);
		}
	});
});

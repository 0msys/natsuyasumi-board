import { describe, expect, it } from 'bun:test';
import { baseScoreMax, chartScoreMax } from './scoreScale';

describe('baseScoreMax', () => {
	it('チャレンジ込みの上限からでも、基本点の満点100を返す', () => {
		expect(baseScoreMax(200)).toBe(100); // サンプル定義（チャレンジ4件）
		expect(baseScoreMax(150)).toBe(100); // 標準テンプレート（チャレンジ2件）
		expect(baseScoreMax(100)).toBe(100); // チャレンジ無し
	});

	it('区分が空で上限が下がっていれば、その値をそのまま返す', () => {
		// 「50点 / 100点」＝全部やったのに半分に見える、を出さない
		expect(baseScoreMax(50)).toBe(50);
		expect(baseScoreMax(0)).toBe(0);
	});
});

describe('chartScoreMax', () => {
	it('ふつうは score_max がそのまま分母になる', () => {
		expect(chartScoreMax(200)).toBe(200);
		expect(chartScoreMax(50)).toBe(50);
	});

	it('両方の区分が空（score_max=0）でも 0除算にしない', () => {
		// 記録は項目を消しても残るので total=0 の日が届く。0/0 は NaN になり、
		// SVG の座標が壊れて折れ線ごと消える。
		const axis = chartScoreMax(0);
		expect(axis).toBe(1);
		const y = (100 - 10) * 0 / axis;
		expect(Number.isNaN(y)).toBe(false);
	});
});

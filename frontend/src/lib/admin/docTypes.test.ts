import { describe, expect, it } from 'bun:test';
import { formatMinutes, MEDIA_LIMIT_MINUTES_MAX } from './docTypes';

describe('formatMinutes', () => {
	it('1時間未満は分だけ', () => {
		expect(formatMinutes(1)).toBe('1分');
		expect(formatMinutes(45)).toBe('45分');
		expect(formatMinutes(59)).toBe('59分');
	});

	it('ちょうどの時間は「0分」を付けない（子ども画面の上限ラベルと同じ組み立て）', () => {
		expect(formatMinutes(60)).toBe('1時間');
		expect(formatMinutes(120)).toBe('2時間');
		expect(formatMinutes(MEDIA_LIMIT_MINUTES_MAX)).toBe('24時間');
	});

	it('はんぱな分は時間＋分', () => {
		expect(formatMinutes(61)).toBe('1時間1分');
		expect(formatMinutes(90)).toBe('1時間30分');
	});

	it('負の数・小数はまるめて壊れない（number 入力から来る）', () => {
		expect(formatMinutes(-5)).toBe('0分');
		expect(formatMinutes(90.7)).toBe('1時間30分');
	});
});

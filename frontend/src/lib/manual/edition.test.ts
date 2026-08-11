// マニュアルの既定タブを決める __NYB_LITE__ の読み方を固定する。
//
// この定数は vite.config.ts の define で埋めるので、bun test の world には存在しない。
// runningEdition() の typeof ガードを外して裸の参照に戻すと、このファイルは
// ReferenceError で丸ごと落ちる——それがこのテストの主目的で、値の検査はおまけ。
import { describe, expect, it } from 'bun:test';
import { EDITIONS, editionOnlyLabel, runningEdition } from './edition';

describe('runningEdition', () => {
	it('define の無い環境（bun test）でも投げない', () => {
		// typeof ガードが外れるとここが ReferenceError になる。
		expect(() => runningEdition()).not.toThrow();
	});

	it('define が無ければ docker とみなす', () => {
		expect(runningEdition()).toBe('docker');
	});
});

describe('EDITIONS', () => {
	it('lite と docker の2つを、この順で持つ', () => {
		expect(EDITIONS.map((e) => e.id)).toEqual(['lite', 'docker']);
	});

	it('どのラベルも空でない（切り替えボタンの文字になる）', () => {
		for (const e of EDITIONS) expect(e.label.length).toBeGreaterThan(0);
	});
});

describe('editionOnlyLabel', () => {
	it('版ごとに違う帯の見出しを返す', () => {
		expect(editionOnlyLabel('lite')).toBe('lite版だけ');
		expect(editionOnlyLabel('docker')).toBe('docker版だけ');
	});
});

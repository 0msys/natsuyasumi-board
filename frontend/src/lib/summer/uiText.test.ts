import { describe, expect, it } from 'bun:test';
import { fmt } from './uiText';
import { stripRuby } from './ruby';

describe('fmt', () => {
	it('{name} を値で埋める', () => {
		expect(fmt('つぎは {rank}（あと{rest}点《てん》）', { rank: 'ランクB', rest: 120 })).toBe(
			'つぎは ランクB（あと120点《てん》）'
		);
	});

	it('値が無いプレースホルダはそのまま残す（消して文が壊れるより気づける）', () => {
		expect(fmt('いま {total} 点《てん》', {})).toBe('いま {total} 点《てん》');
	});

	it('差し込んだ値は再走査しない（ユーザ定義ラベルに{}が入っていても安全）', () => {
		expect(fmt('たっせい: {rank}', { rank: '{total}' })).toBe('たっせい: {total}');
	});

	it('差し込んだルビ記法はそのまま生きる（埋めてから Ruby に通せる）', () => {
		const filled = fmt('つぎは {due}までに {item}', { due: '8/25', item: '音読《おんどく》カード' });
		expect(filled).toBe('つぎは 8/25までに 音読《おんどく》カード');
		expect(stripRuby(filled)).toBe('つぎは 8/25までに おんどくカード');
	});

	it('プレースホルダが無い文言は素通し', () => {
		expect(fmt('生活《せいかつ》', { n: 1 })).toBe('生活《せいかつ》');
	});
});

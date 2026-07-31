// ルビ記法パーサ・描画・除去の単体テスト（bun run test src/lib/summer/ruby.test.ts）。
import { describe, expect, test } from 'bun:test';
import { parseRuby, renderRubyHtml, stripRuby } from './ruby';

describe('parseRuby: 基底＝直前の漢字ラン', () => {
	test('ルビ無しはそのままテキスト1セグメント', () => {
		expect(parseRuby('あさごはん')).toEqual([{ kind: 'text', text: 'あさごはん' }]);
	});
	test('単漢字＋よみ', () => {
		expect(parseRuby('朝《あさ》')).toEqual([{ kind: 'ruby', base: '朝', rt: 'あさ' }]);
	});
	test('漢字ラン（複数字）は最長ランが基底', () => {
		expect(parseRuby('国語《こくご》')).toEqual([{ kind: 'ruby', base: '国語', rt: 'こくご' }]);
	});
	test('漢字＋送りがな（食べた）は基底が漢字1字・残りはテキスト', () => {
		expect(parseRuby('食《た》べた')).toEqual([
			{ kind: 'ruby', base: '食', rt: 'た' },
			{ kind: 'text', text: 'べた' }
		]);
	});
	test('前後にかな・記号が混じる', () => {
		expect(parseRuby('はみがき（朝《あさ》）')).toEqual([
			{ kind: 'text', text: 'はみがき（' },
			{ kind: 'ruby', base: '朝', rt: 'あさ' },
			{ kind: 'text', text: '）' }
		]);
	});
	test('複数のルビが1文に', () => {
		expect(parseRuby('国語《こくご》か図工《ずこう》')).toEqual([
			{ kind: 'ruby', base: '国語', rt: 'こくご' },
			{ kind: 'text', text: 'か' },
			{ kind: 'ruby', base: '図工', rt: 'ずこう' }
		]);
	});
});

describe('parseRuby: ｜による基底の明示', () => {
	test('｜ で基底の開始を限定（直前のかなを巻き込まない）', () => {
		expect(parseRuby('お｜手《て》つだい')).toEqual([
			{ kind: 'text', text: 'お' },
			{ kind: 'ruby', base: '手', rt: 'て' },
			{ kind: 'text', text: 'つだい' }
		]);
	});
});

describe('parseRuby: 不正入力は寛容にリテラル化（壊さない）', () => {
	test('閉じ《》が無い《はそのまま', () => {
		expect(parseRuby('あ《い')).toEqual([{ kind: 'text', text: 'あ《い' }]);
	});
	test('単独の》はそのまま', () => {
		expect(parseRuby('あ》い')).toEqual([{ kind: 'text', text: 'あ》い' }]);
	});
	test('基底が無い（直前が漢字でない）ルビはリテラル表示', () => {
		expect(parseRuby('あ《い》')).toEqual([{ kind: 'text', text: 'あ《い》' }]);
	});
});

describe('renderRubyHtml: HTML断片（XSS安全にエスケープ）', () => {
	test('ルビは <ruby><rt> を組む', () => {
		expect(renderRubyHtml('朝《あさ》ごはん')).toBe('<ruby>朝<rt>あさ</rt></ruby>ごはん');
	});
	test('非ルビ部の危険文字はエスケープ', () => {
		expect(renderRubyHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
	});
	test('空・null 安全', () => {
		expect(renderRubyHtml('')).toBe('');
		// @ts-expect-error 実行時の null/undefined 耐性を確認
		expect(renderRubyHtml(undefined)).toBe('');
	});
});

describe('stripRuby: よみ（かな）へ畳む（TTS・属性用）', () => {
	test('基底《よみ》→よみ', () => {
		expect(stripRuby('食《た》べた')).toBe('たべた');
	});
	test('複数ルビも純かなに', () => {
		expect(stripRuby('国語《こくご》か図工《ずこう》')).toBe('こくごかずこう');
	});
	test('ルビ無しはそのまま', () => {
		expect(stripRuby('はみがき（あさ）')).toBe('はみがき（あさ）');
	});
	test('｜ は除去', () => {
		expect(stripRuby('お｜手《て》つだい')).toBe('おてつだい');
	});
});

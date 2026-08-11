// マニュアル本文が引いている画面文言が、生成物とつながったままであることを見る。
//
// SCREEN は backend/app/summer/ui_text.py の生成物からキーで引いている。キーが改名・削除
// されると、引けなかった値が黙って空文字になり、本文が「 を押します」になる。CI の golden
// ジョブは生成物の差分しか見ないので、そこでは捕まらない。ここで止める。
import { describe, expect, it } from 'bun:test';
import { SCREEN } from './labels';

const entries = Object.entries(SCREEN);

describe('SCREEN', () => {
	it('引けなかったキーが無い（空文字は ui_text.py 側の改名・削除のしるし）', () => {
		expect(entries.filter(([, v]) => v === '').map(([k]) => k)).toEqual([]);
	});

	it('ルビ記法が残っていない（親向けなので漢字のまま出す）', () => {
		// stripRubyMarkup の向きの取り違え（stripRuby だと「きょうのチェック」になる）も
		// ここで気づけるよう、代表を1つ実物で押さえておく。
		expect(SCREEN.todayChecks).toBe('今日のチェック');
		for (const [key, value] of entries) {
			expect(value, `${key} にルビ記法が残っている`).not.toMatch(/[《》｜]/);
		}
	});

	it('差し込みプレースホルダを含むキーを混ぜていない', () => {
		// {name} や {max} が入るキーは、そのまま本文へ置くと「{max}点」と出てしまう。
		for (const [key, value] of entries) {
			expect(value, `${key} は差し込みつきの文言`).not.toMatch(/[{}]/);
		}
	});
});

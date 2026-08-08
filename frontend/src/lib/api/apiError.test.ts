// エラー文言の取り出しを固定する。
//
// ここが緩むと失敗が「見えなくなる」側に倒れる（空のバナーは何も描画されない）ので、
// 「必ず何か返す」ことと「子どもの画面に数字を出さない」ことを機械で見張る。
import { describe, expect, it } from 'bun:test';
import { childErrorText, errorDetail, errorStatus } from './apiError';
import { ApiError } from './contract';

describe('errorStatus', () => {
	it('ApiError からは status をそのまま取る', () => {
		expect(errorStatus(new ApiError(409, 'ほかの画面で変更されています'))).toBe(409);
	});

	it('api を通らない素の Error は `path → 404` の形から拾う', () => {
		expect(errorStatus(new Error('/api/admin/definitions/はな → 404 '))).toBe(404);
	});

	it('手がかりが無ければ null（呼び出し側は分岐しない）', () => {
		expect(errorStatus(new Error('Failed to fetch'))).toBeNull();
	});
});

describe('errorDetail（管理画面＝親に見せる）', () => {
	it('サーバの `{"detail": "..."}` は中身だけ出す', () => {
		const e = new ApiError(422, '{"detail": "こうもくの key が かぶっています"}', '/api/x');
		expect(errorDetail(e)).toBe('こうもくの key が かぶっています');
	});

	it('lite 側の素の detail はそのまま出す', () => {
		expect(errorDetail(new ApiError(409, '「そら」はもう居ます'))).toBe('「そら」はもう居ます');
	});

	// 削除・保存の失敗が画面から消える経路。バナーは `{#if error}` なので、
	// ここが空文字を返した瞬間に「黙って失敗する」に変わる。
	it('本文が空の 500/502 でも空文字は返さない（status を添える）', () => {
		const shown = errorDetail(new ApiError(502, '', '/api/admin/definitions/はな'));
		expect(shown).not.toBe('');
		expect(shown).toContain('502');
	});

	it('空白だけの本文も同じ扱い', () => {
		expect(errorDetail(new ApiError(500, '   \n ')).length).toBeGreaterThan(0);
	});

	it('detail が JSON でも文字列でなければ落ちずに何か返す', () => {
		const shown = errorDetail(new ApiError(500, '{"detail": {"loc": ["body"]}}'));
		expect(shown.length).toBeGreaterThan(0);
	});

	it('api を通らない素の Error は原文を出す', () => {
		expect(errorDetail(new Error('ほぞんを よみこめなかったよ'))).toBe(
			'ほぞんを よみこめなかったよ'
		);
	});

	it('Error ですらない投げものでも空にはしない', () => {
		expect(errorDetail(undefined).length).toBeGreaterThan(0);
		expect(errorDetail('').length).toBeGreaterThan(0);
	});
});

describe('childErrorText（子どもページ＝ひらがなの画面に出す）', () => {
	// lite の書き込みエラーは where 無しで投げるので、message は「400 まだ…」になる。
	// message を出していたころは、この数字がそのまま子どもの画面に出ていた。
	it('lite の書き込みエラーは status を出さない', () => {
		const e = new ApiError(400, 'まだ さきのひは かけないよ');
		expect(childErrorText(e)).toBe('まだ さきのひは かけないよ');
		expect(childErrorText(e)).not.toContain('400');
	});

	it('docker 版の JSON 本文も中身だけ出す', () => {
		const e = new ApiError(400, '{"detail": "その こうもくが みつからないよ"}', '/api/summer/check/set');
		expect(childErrorText(e)).toBe('その こうもくが みつからないよ');
	});

	// 読み上げ再生の DOMException や通信断はここに来る。英語のまま出すわけにいかない。
	it('api が付けた文言でないものは、決まった一言に畳む', () => {
		const shown = childErrorText(new Error('The play() request was interrupted'));
		expect(shown).not.toContain('play()');
		expect(shown).toContain('もういちど');
	});

	it('本文が空の ApiError も決まった一言（空バナーにしない）', () => {
		expect(childErrorText(new ApiError(502, '', '/api/summer/check/set'))).toContain('もういちど');
	});

	// ここから下は「detail はあるが、人向けに書かれたものではない」ケース。
	// 素通しすると、ひらがなの画面に英語やタグがそのまま出る。
	it('Starlette が素の 500 で返す英語の本文は出さない', () => {
		const e = new ApiError(500, 'Internal Server Error', '/api/summer/check/set');
		expect(childErrorText(e)).not.toContain('Internal');
		expect(childErrorText(e)).toContain('もういちど');
	});

	it('プロキシの 502 の HTML は出さない', () => {
		const html = '<html><head><title>502 Bad Gateway</title></head><body></body></html>';
		expect(childErrorText(new ApiError(502, html, '/api/summer/check/set'))).toContain('もういちど');
	});

	it('FastAPI の 422（detail が配列）は出さない', () => {
		const body = '{"detail":[{"type":"missing","loc":["body","item_key"],"msg":"Field required"}]}';
		const shown = childErrorText(new ApiError(422, body, '/api/summer/check/set'));
		expect(shown).not.toContain('loc');
		expect(shown).toContain('もういちど');
	});

	// 日本語でも大人あての文言はある。「日本語かどうか」だけで通すと、これが素通りする。
	it('定義が壊れている 503 は、日本語でも出さない（大人あて）', () => {
		// lite: shared.ts / docker: summer.py がこの形で投げる
		const lite = new ApiError(503, '「はな」の定義がありません');
		expect(childErrorText(lite)).toContain('もういちど');

		const docker = new ApiError(
			503,
			'{"detail": "はな（2026年）: 必須キー \'period\' がありません"}',
			'/api/summer/state'
		);
		expect(childErrorText(docker)).not.toContain('必須キー');
	});

	it('読み上げの失敗（話者ID つき）も出さない（英字が混ざる＝大人あて）', () => {
		const e = new ApiError(400, 'この声（話者ID 3）では合成できません', '/api/tts');
		expect(childErrorText(e)).not.toContain('話者');
		expect(childErrorText(e)).toContain('もういちど');
	});

	it('子どもあての 400 は、数字や記号が混ざっていても出す（弾きすぎていない）', () => {
		// service.py の実文言（数字と「」（）が混ざる）
		const e = new ApiError(400, 'どれか1つはえらんでね（ぜんぶ「やらない」にはできないよ）');
		expect(childErrorText(e)).toBe('どれか1つはえらんでね（ぜんぶ「やらない」にはできないよ）');
	});
});

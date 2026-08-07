// 記録のキーに載せられない文字を、保存の前に断っているか。
//
// $lib/api 経由では import しない（テストの共通モックに食われる）。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { addDays } from '$lib/core/dates';
import { todayJst } from '$lib/core/clock';
import { read, setPersistence } from '$lib/store/db';
import { memoryPersistence } from '$lib/store/persist';
import { api } from './index';

// キーの区切りに使っている文字（U+0000）。ソースに直接置くと見えないので名前で持つ。
const SEP = '\u0000';
const today = todayJst();
const PERIOD = {
	start: addDays(today, -10),
	end: addDays(today, 20),
	first_day_of_school: addDays(today, 21)
};

const doc = (child: string, habitKey = 'h_ok') => ({
	child,
	child_kana: 'はな',
	year: Number(today.slice(0, 4)),
	grade: '小2',
	period: PERIOD,
	habits: [{ key: habitKey, label: 'はみがき' }]
});

beforeEach(() => setPersistence(memoryPersistence()));
afterEach(() => setPersistence(null));

describe('キーに載せられない文字', () => {
	// 通してしまうと、書き込みは成功するのに読み出しで別のものに見える。
	// 「保存できたのに次に開いたら消えている」がいちばん気づきにくい壊れかた。
	it('名前に区切り文字が入った定義は取り込まない', async () => {
		expect(api.adminImportDefinition(doc(`はな${SEP}そら`))).rejects.toThrow('使えない文字');
		expect(await read((db) => Object.keys(db.definitions))).toHaveLength(0);
	});

	it('項目キーに区切り文字が入った定義も取り込まない', async () => {
		expect(api.adminImportDefinition(doc('はな', `h_a${SEP}b`))).rejects.toThrow('使えない文字');
		expect(await read((db) => Object.keys(db.definitions))).toHaveLength(0);
	});

	it('区切り文字を含む名前へは改名できない', async () => {
		await api.adminImportDefinition(doc('はな'));
		expect(api.adminRenameChild('はな', `そら${SEP}うみ`)).rejects.toThrow('使えない文字');
	});

	it('ふつうの名前はこれまでどおり通る（締めすぎていない）', async () => {
		await api.adminImportDefinition(doc('はな'));
		await api.summerSetCheck('はな', today, 'h_ok', 'done');
		// 書いたものが、そのまま読み出せる
		expect((await api.summerState('はな')).today_score!.score).toBeGreaterThan(0);
	});
});

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

describe('バックアップからの復元', () => {
	const backup = (db: Record<string, unknown>) => ({
		format: 'natsuyasumi-board/backup',
		version: 1,
		exported_at: 1_785_000_000,
		schema_version: 1,
		db
	});

	// 8巡目の検査は定義の作成・保存だけを守っていた。復元はキーを直接持ち込むので、
	// そちらにも要る（通すと、復元は成功したのにその子の記録が出てこない）。
	it('区切り文字の入ったキーを持つバックアップは取り込まない', async () => {
		await api.adminImportDefinition(doc('はな'));
		const before = (await api.summerChildren()).children.length;

		const broken = backup({
			definitions: { [`はな${SEP}2026`]: { child: 'はな', year: 2026, doc: {}, revision: 1 } },
			// 名前に区切りが混ざった記録（部品が1つ多くなる）
			daily_checks: {
				[`A${SEP}B${SEP}2026-08-01${SEP}h_x`]: { status: 'done', checked_at: 0, meta: null }
			},
			flags: {}
		});
		expect(api.backupImportAll(broken)).rejects.toThrow('読めないキー');
		expect((await api.summerChildren()).children).toHaveLength(before);
	});

	it('キーと中身が食い違う定義も取り込まない', async () => {
		const broken = backup({
			definitions: { [`はな${SEP}2026`]: { child: 'そら', year: 2026, doc: {}, revision: 1 } },
			daily_checks: {},
			flags: {}
		});
		expect(api.backupImportAll(broken)).rejects.toThrow('食い違って');
	});
});

describe('端末ごとの事情は引き継がない', () => {
	// バックアップは「端末を替えるときの引き継ぎ」として案内している。
	// 元の端末の設定を持ち込むと、いちばん要る移行先で守りが外れる。
	it('復元しても、この端末の保存の持続と案内の状態はそのまま', async () => {
		await api.adminImportDefinition(doc('はな'));
		// この端末はまだ何も聞かれていない／案内も閉じていない、という状態にする
		const status0 = await api.backupStatus();
		expect(status0.home_hint_dismissed).toBe(false);

		// 元の端末では「許可済み・案内は閉じた」だったバックアップ
		const { payload } = await api.backupExportAll();
		const p = payload as { db: { meta: Record<string, unknown> } };
		p.db.meta.persisted = true;
		p.db.meta.home_hint_dismissed = true;

		await api.backupImportAll(payload);
		const status = await api.backupStatus();
		expect(status.home_hint_dismissed, '元の端末の「案内を閉じた」が持ち込まれた').toBe(false);
		expect(status.changes_since_backup, '復元した直後なのに変更ありと出る').toBe(0);
	});
});

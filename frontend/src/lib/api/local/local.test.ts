// lite 版 api の通しテスト（保存層こみ）。
//
// $lib/api 経由では import しない。テストの共通モック（src/test-support/apiMock.ts）が
// その名前を丸ごと差し替えてしまうので、実装ではなくモックを検査することになる。
// ここは実装そのものを見たいので、相対パスで直接読む。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { addDays } from '$lib/core/dates';
import { todayJst } from '$lib/core/clock';
import { setPersistence, read } from '$lib/store/db';
import { memoryPersistence } from '$lib/store/persist';
import { checkKey, flagKey } from '$lib/store/model';
import { api } from './index';
import { ApiError } from '../contract';

const CHILD = 'はな';
const today = todayJst();
// 期間は「今日」をまん中に置く（今日が期間外だと、書き込みが軒並み弾かれてしまう）
const PERIOD = {
	start: addDays(today, -10),
	end: addDays(today, 20),
	first_day_of_school: addDays(today, 21)
};

async function wizard(child = CHILD, year = Number(today.slice(0, 4))) {
	return api.adminCreateDefinition({
		child,
		child_kana: child,
		grade: '小2',
		year,
		period: PERIOD,
		template: 'standard'
	});
}

/** 標準テンプレートの、採番済みの項目キーを引く。 */
async function keysOf(child = CHILD) {
	const entry = await api.adminGetDefinition(child);
	const doc = entry.doc as Record<string, { key: string }[]>;
	return {
		doc: entry.doc,
		revision: entry.revision,
		year: entry.year,
		habits: doc.habits.map((h) => h.key),
		daily: doc.daily_homework.map((h) => h.key),
		practice: doc.practice_homework.map((h) => h.key),
		challenges: doc.special_challenges.map((h) => h.key)
	};
}

beforeEach(() => setPersistence(memoryPersistence()));
afterEach(() => setPersistence(null));

describe('初回登録と読み出し', () => {
	it('ウィザードで作ると、子ども一覧と画面 state が出る', async () => {
		await wizard();
		const { children } = await api.summerChildren();
		expect(children).toHaveLength(1);
		expect(children[0].child).toBe(CHILD);
		expect(children[0].valid).toBe(true);

		const state = await api.summerState(CHILD);
		expect(state.child).toBe(CHILD);
		expect(state.in_period).toBe(true);
		expect(state.today).toBe(today);
		// 固定文言は学年ぶんだけ漢字が開かれて入っている
		expect(typeof state.ui.header_title).toBe('string');
		expect(state.history).toHaveLength(31);
	});

	it('同じ子の同じ年は二度作れない', async () => {
		await wizard();
		expect(wizard()).rejects.toThrow(/もう登録されています/);
	});

	it('定義が無い子を読むと 503（画面は「よみこめなかった」を出す）', async () => {
		const err = await api.summerState('だれか').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(503);
	});
});

describe('日次3値の記録', () => {
	beforeEach(async () => {
		await wizard();
	});

	it('やった／やらなかった／未記入へ戻す', async () => {
		const k = await keysOf();
		expect(await api.summerSetCheck(CHILD, today, k.habits[0], 'done')).toEqual({
			status: 'done'
		});
		let state = await api.summerState(CHILD);
		expect(state.today_score!.score).toBeGreaterThan(0);

		await api.summerSetCheck(CHILD, today, k.habits[0], 'not_done');
		state = await api.summerState(CHILD);
		expect(state.today_score!.score).toBe(0);

		// 未記入へ戻すと行ごと消える（null を残すと「記録あり」と数えてしまう）
		await api.summerSetCheck(CHILD, today, k.habits[0], null);
		const db = await read((d) => d);
		expect(checkKey(CHILD, today, k.habits[0]) in db.daily_checks).toBe(false);
	});

	it('未来の日には書けない', async () => {
		const k = await keysOf();
		expect(
			api.summerSetCheck(CHILD, addDays(today, 1), k.habits[0], 'done')
		).rejects.toThrow('まだ さきのひは かけないよ');
	});

	it('期間の外には書けない', async () => {
		const k = await keysOf();
		expect(
			api.summerSetCheck(CHILD, addDays(PERIOD.start, -1), k.habits[0], 'done')
		).rejects.toThrow('なつやすみの きかんじゃ ないひだよ');
	});

	it('中止は cancelable の項目にしか書けない', async () => {
		const k = await keysOf();
		expect(api.summerSetCheck(CHILD, today, k.habits[0], 'cancelled')).rejects.toThrow(
			'その きろくは できないみたい'
		);
	});

	it('全部やると100点で、チャレンジ枠が解放される', async () => {
		const k = await keysOf();
		const state0 = await api.summerState(CHILD);
		// その日に記録欄がある習慣だけを埋める（edges の窓の外は分母に入らない）
		const due = state0.habits.filter((h) => h.window_active).map((h) => h.key);
		for (const key of [...due, ...k.daily, ...k.practice]) {
			await api.summerSetCheck(CHILD, today, key, 'done');
		}
		const state = await api.summerState(CHILD);
		expect(state.today_score!.score).toBe(100);
		expect(state.today_score!.unlocked).toBe(true);
		expect(state.streaks.perfect_total).toBe(1);

		await api.summerSetCheck(CHILD, today, k.challenges[0], 'done');
		const withBonus = await api.summerState(CHILD);
		expect(withBonus.today_score!.total).toBe(125);
		expect(withBonus.comment!.band).toBe('perfect_plus');
	});
});

describe('メモ', () => {
	beforeEach(async () => {
		await wizard();
	});

	it('「やった」にしてからでないと書けない', async () => {
		const k = await keysOf();
		const doc = k.doc as Record<string, { key: string; meta?: { key: string }[] }[]>;
		const item = doc.daily_homework.find((i) => i.meta?.length)!;
		expect(
			api.summerSetMeta(CHILD, today, item.key, { [item.meta![0].key]: 'ぐりとぐら' })
		).rejects.toThrow('さきに「やった」にしてから、メモをかいてね');

		await api.summerSetCheck(CHILD, today, item.key, 'done');
		const r = await api.summerSetMeta(CHILD, today, item.key, {
			[item.meta![0].key]: '  ぐりとぐら  '
		});
		expect(r.meta[item.meta![0].key]).toBe('ぐりとぐら');
	});

	it('「やらなかった」に変えるとメモは消える', async () => {
		const k = await keysOf();
		const doc = k.doc as Record<string, { key: string; meta?: { key: string }[] }[]>;
		const item = doc.daily_homework.find((i) => i.meta?.length)!;
		await api.summerSetCheck(CHILD, today, item.key, 'done');
		await api.summerSetMeta(CHILD, today, item.key, { [item.meta![0].key]: 'ぐりとぐら' });
		await api.summerSetCheck(CHILD, today, item.key, 'not_done');
		const db = await read((d) => d);
		expect(db.daily_checks[checkKey(CHILD, today, item.key)].meta).toBeNull();
	});
});

describe('管理画面の保存', () => {
	beforeEach(async () => {
		await wizard();
	});

	it('古い revision で保存すると 409', async () => {
		const entry = await api.adminGetDefinition(CHILD);
		await api.adminSaveDefinition(CHILD, entry.doc, entry.revision);
		const err = await api
			.adminSaveDefinition(CHILD, entry.doc, entry.revision)
			.catch((e) => e);
		expect((err as ApiError).status).toBe(409);
	});

	it('履歴は10世代で打ち切る', async () => {
		let entry = await api.adminGetDefinition(CHILD);
		for (let i = 0; i < 12; i++) {
			entry = await api.adminSaveDefinition(CHILD, entry.doc, entry.revision);
		}
		const db = await read((d) => d);
		const history = Object.values(db.definition_history)[0];
		expect(history).toHaveLength(10);
		expect(entry.revision).toBe(13);
	});

	it('名前を変えると、記録もぜんぶ付いてくる', async () => {
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		const state0 = await api.summerState(CHILD);
		const oneShotKey = state0.one_shot[0]?.key;

		await api.adminRenameChild(CHILD, 'そら');
		const db = await read((d) => d);
		expect(Object.keys(db.definitions).some((key) => key.startsWith('はな'))).toBe(false);
		expect(checkKey('そら', today, k.habits[0]) in db.daily_checks).toBe(true);
		if (oneShotKey) expect(flagKey('そら', oneShotKey) in db.flags).toBe(false); // まだ触っていない

		const moved = await api.summerState('そら');
		expect(moved.today_score!.score).toBeGreaterThan(0);
	});

	it('削除しても記録は残る（登録し直せば戻る）', async () => {
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		await api.adminDeleteDefinition(CHILD);
		const db = await read((d) => d);
		expect(Object.keys(db.definitions)).toHaveLength(0);
		expect(checkKey(CHILD, today, k.habits[0]) in db.daily_checks).toBe(true);
	});
});

describe('来年ぶん', () => {
	it('項目は引き継ぎ、キーは振り直す（去年の「できた」を持ち越さない）', async () => {
		await wizard();
		const before = await keysOf();
		const state = await api.summerState(CHILD);
		// じゅんび項目に印をつけておく（フラグは年を持たないので、ここが要）
		const prep = state.school_start_items[0];
		if (prep) await api.summerToggleFlag(CHILD, prep.key);

		const next = await api.adminCreateNextYear(CHILD);
		expect(next.year).toBe(before.year + 1);
		const nextDoc = next.doc as Record<string, { key: string }[]>;
		expect((next.doc as { grade: string }).grade).toBe('小3');
		// 同じキーが1つも残っていないこと
		const beforeKeys = new Set([...before.habits, ...before.daily, ...before.practice]);
		for (const item of [...nextDoc.habits, ...nextDoc.daily_homework]) {
			expect(beforeKeys.has(item.key)).toBe(false);
		}
		// おでかけの予定は空になる
		expect((next.doc as { away: unknown[] }).away).toEqual([]);
	});

	it('小6の次は作れない', async () => {
		await api.adminCreateDefinition({
			child: 'ろく',
			child_kana: 'ろく',
			grade: '小6',
			year: Number(today.slice(0, 4)),
			period: PERIOD,
			template: 'empty'
		});
		expect(api.adminCreateNextYear('ろく')).rejects.toThrow('小6の次の学年はありません');
	});
});

describe('テレビタイマー', () => {
	beforeEach(async () => {
		await wizard();
	});

	it('start は二度押しても増えない。pause で積み上がる', async () => {
		const a = await api.summerMediaTimerStart(CHILD);
		expect(a.running).toBe(true);
		const b = await api.summerMediaTimerStart(CHILD);
		expect(b.resumed_at).toBe(a.resumed_at); // 押し直しても再開時刻は動かない

		const paused = await api.summerMediaTimerPause(CHILD);
		expect(paused.running).toBe(false);
		expect(paused.accumulated_seconds).toBeGreaterThanOrEqual(0);

		// 止まっているあいだは増えない
		const later = await api.summerMediaTimerState(CHILD);
		expect(later.elapsed_seconds).toBe(paused.accumulated_seconds);
		// 上限の表示はその子の学年で開いた文字列
		expect(later.limit_label).toContain('時間');
	});
});

describe('読み上げは入っていない', () => {
	it('available も supported も false（画面のボタンごと消える）', async () => {
		expect(await api.ttsStatus()).toMatchObject({ available: false });
		expect(await api.ttsSpeakers()).toMatchObject({ available: false, supported: false });
		expect(api.ttsBlob('こんにちは')).rejects.toThrow(/よみあげは ありません/);
	});
});

describe('エクスポート', () => {
	it('ファイル名は {年}-{名前}.json', async () => {
		await wizard();
		const { filename, doc } = await api.adminExportDoc(CHILD);
		expect(filename).toBe(`${Number(today.slice(0, 4))}-${CHILD}.json`);
		expect((doc as { child: string }).child).toBe(CHILD);
	});
});

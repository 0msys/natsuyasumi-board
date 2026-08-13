// lite 版 api の通しテスト（保存層こみ）。
//
// $lib/api 経由では import しない。テストの共通モック（src/test-support/apiMock.ts）が
// その名前を丸ごと差し替えてしまうので、実装ではなくモックを検査することになる。
// ここは実装そのものを見たいので、相対パスで直接読む。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { addDays } from '$lib/core/dates';
import { nowEpochSec, todayJst } from '$lib/core/clock';
import { setPersistence, read } from '$lib/store/db';
import { memoryPersistence, type Persistence } from '$lib/store/persist';
import { checkKey, flagKey, type Db } from '$lib/store/model';
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
async function keysOf(child = CHILD, year?: number) {
	const entry = await api.adminGetDefinition(child, year);
	const doc = entry.doc as Record<string, { key: string }[]>;
	return {
		doc: entry.doc,
		revision: entry.revision,
		year: entry.year,
		habits: doc.habits.map((h) => h.key),
		daily: doc.daily_homework.map((h) => h.key),
		challenges: doc.special_challenges.map((h) => h.key)
	};
}

/** 保存の中身を外から差し替えられる置き場（別の版が書いた保存を作るのに使う）。 */
function pokeablePersistence(): Persistence & { poke(db: unknown): void } {
	let current: unknown = null;
	const copy = (db: unknown) => JSON.parse(JSON.stringify(db));
	return {
		load: async () => current,
		save: async (db) => {
			current = copy(db);
		},
		clear: async () => {
			current = null;
		},
		poke: (db) => {
			current = copy(db);
		}
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

	// はじめてこのアプリを触る親が最初に作る定義。作った直後に赤や黄が出ているのも、
	// 出ないまま「絶対に取れないごほうび」が入っているのも困る（issue #28）。
	it('ウィザードで作った定義は、そのまま検証を警告なしで通る', async () => {
		await wizard();
		const entry = await api.adminGetDefinition(CHILD);
		const result = await api.adminValidateDefinition(CHILD, entry.doc);
		expect(result.errors).toEqual([]);
		expect(
			result.warnings.map((w) => w.code),
			'はじめの設定で作っただけの定義に警告が出ている'
		).toEqual([]);
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
		for (const key of [...due, ...k.daily]) {
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

	it('「ぜんぶできたら○点」は項目数から出す（標準テンプレは2つで150点）', async () => {
		// 数字を文言に直書きしていたころは、どの子にも「200点」（4項目ぶん）と出ていた
		const state = await api.summerState(CHILD);
		expect(state.score_max).toBe(150);
		expect(state.ui.challenge_all).toContain('150');
		expect(state.ui.challenge_all).not.toContain('{score_max}');
	});

	it('過去の日のチャレンジもあとから付け外しできる', async () => {
		const k = await keysOf();
		const yesterday = addDays(today, -1);
		// その日に記録欄がない習慣（edges の窓の外）へ書いても採点の分母には入らないので、
		// 過去日は全部まとめて埋めてよい＝きのうの due を別途組み立てなくて済む
		for (const key of [...k.habits, ...k.daily]) {
			await api.summerSetCheck(CHILD, yesterday, key, 'done');
		}
		const dayOf = async () =>
			(await api.summerState(CHILD)).history.find((h) => h.day === yesterday)!;
		expect((await dayOf()).score).toBe(100);

		await api.summerSetCheck(CHILD, yesterday, k.challenges[0], 'done');
		expect((await dayOf()).total).toBe(125); // 履歴の合計が再計算される
		// きょうの枠には出ない（過去日の◯は history[].statuses からしか読めない）
		expect((await api.summerState(CHILD)).special_challenges[0].status).toBe(null);

		await api.summerSetCheck(CHILD, yesterday, k.challenges[0], null);
		expect((await dayOf()).total).toBe(100);
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

	it('長すぎるメモは絵文字を割らずに切り詰める', async () => {
		const k = await keysOf();
		const doc = k.doc as Record<string, { key: string; meta?: { key: string }[] }[]>;
		const item = doc.daily_homework.find((i) => i.meta?.length)!;
		const fieldKey = item.meta![0].key;
		await api.summerSetCheck(CHILD, today, item.key, 'done');

		// 100文字目がサロゲートペア（絵文字）になるだいめい。UTF-16 のまま切ると割れる。
		const title = 'あ'.repeat(99) + '🍉' + 'ものがたり';
		const r = await api.summerSetMeta(CHILD, today, item.key, { [fieldKey]: title });

		const saved = String(r.meta[fieldKey]);
		expect([...saved]).toHaveLength(100); // 数え方はバックエンド（コードポイント）に合わせる
		expect(saved.endsWith('🍉')).toBe(true); // 絵文字は丸ごと残るか、丸ごと落ちる
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

describe('名前の変更', () => {
	it('消した子の記録がのこっている名前へは変えられない', async () => {
		// 兄弟で同じ設定を使い回すと、項目キーまで一致する（README が勧めている使いかた）
		const shared = (child: string) => ({
			child,
			child_kana: child,
			year: Number(today.slice(0, 4)),
			grade: '小2',
			period: PERIOD,
			habits: [{ key: 'h_same', label: 'はみがき' }]
		});
		await api.adminImportDefinition(shared('はな'));
		await api.adminImportDefinition(shared('そら'));

		// そらに記録を入れてから、定義だけ消す（記録は残る＝登録し直せば戻る）
		await api.summerSetCheck('そら', today, 'h_same', 'done');
		await api.adminDeleteDefinition('そら');

		// ここで はな → そら に改名できてしまうと、そらの記録が黙って上書きされる
		expect(api.adminRenameChild('はな', 'そら')).rejects.toThrow('記録がのこっています');

		const db = await read((d) => d);
		expect(db.daily_checks[checkKey('そら', today, 'h_same')].status).toBe('done');
	});

	it('記録がのこっていない名前へは変えられる', async () => {
		await wizard();
		await api.adminRenameChild(CHILD, 'そら');
		expect((await api.summerChildren()).children[0].child).toBe('そら');
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
		const beforeKeys = new Set([...before.habits, ...before.daily]);
		for (const item of [...nextDoc.habits, ...nextDoc.daily_homework]) {
			expect(beforeKeys.has(item.key)).toBe(false);
		}
		// おでかけの予定は空になる
		expect((next.doc as { away: unknown[] }).away).toEqual([]);
	});

	it('きかん限定をやめた習慣の、空の日付を来年ぶんに書き込まない', async () => {
		// 「きかん限定」にして日付を入れないまま「毎日」へ戻すと、この形が保存できてしまう
		// （検証は window が range のときしか日付を見ない）。前はその空文字を年ずらしして
		// window_start: '0001-00--1' を書き込んでいた（Docker 版は同じ入力で 500）。
		await wizard();
		const entry = await api.adminGetDefinition(CHILD);
		const habits = (entry.doc as Record<string, Record<string, unknown>[]>).habits;
		habits[0].window = null;
		habits[0].window_start = '';
		habits[0].window_end = '';
		await api.adminSaveDefinition(CHILD, entry.doc, entry.revision);

		const next = await api.adminCreateNextYear(CHILD);
		const habit = (next.doc as Record<string, Record<string, unknown>[]>).habits[0];
		expect(habit.window_start).toBeUndefined();
		expect(habit.window_end).toBeUndefined();
		expect(JSON.stringify(next.doc)).not.toContain('0001-'); // 壊れた日付が1つも無いこと
	});

	it('きかん限定の習慣の日付は、落とさずに1年ぶん進める', async () => {
		// backend/tests/test_admin_next_year.py の
		// test_きかん限定の習慣の期間も1年ぶん進む と対。月日が保たれることは
		// src/lib/core/dates.test.ts の shiftYear が押さえるので、ここは年だけ見る。
		await wizard();
		const entry = await api.adminGetDefinition(CHILD);
		const habits = (entry.doc as Record<string, Record<string, unknown>[]>).habits;
		habits[0].window = 'range';
		habits[0].window_start = PERIOD.start;
		habits[0].window_end = PERIOD.end;
		await api.adminSaveDefinition(CHILD, entry.doc, entry.revision);

		const next = await api.adminCreateNextYear(CHILD);
		const habit = (next.doc as Record<string, Record<string, string>[]>).habits[0];
		expect(habit.window).toBe('range');
		expect(habit.window_start.startsWith(String(next.year))).toBe(true);
		expect(habit.window_end.startsWith(String(next.year))).toBe(true);
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

describe('消した年の登録しなおし', () => {
	// 年ごとの削除は「記録は消えません」と約束していて、実際チェックの行は残る。
	// キーを振り直す条件が「同じ子の別の年が居る」だったころは、その約束が取り込みの
	// 側で破れていた——残した記録は古いキーのまま孤児になり、書き出しておいた JSON から
	// 登録しなおしても二度と結びつかない（画面は真っさらのまま）。
	it('書き出しておいた JSON から戻すと、その年の記録も戻る', async () => {
		await wizard();
		const before = await keysOf();
		await api.adminCreateNextYear(CHILD); // 同じ子の別の年が居る状態にする
		await api.summerSetCheck(CHILD, today, before.habits[0], 'done');
		const score = (await api.summerState(CHILD)).today_score!.score;
		expect(score, '前提: 記録が点数に出ている').toBeGreaterThan(0);

		const { doc } = await api.adminExportDoc(CHILD, before.year);
		await api.adminDeleteDefinition(CHILD, before.year);
		await api.adminImportDefinition(doc as Record<string, unknown>);

		const after = await keysOf(CHILD, before.year);
		expect(after.habits, '登録しなおしでキーが振り直されている').toEqual(before.habits);
		expect(
			(await api.summerState(CHILD)).today_score!.score,
			'のこしておいた記録が戻ってこない'
		).toBe(score);
	});

	// 振り直しそのものは要る。フラグ（じゅんび・一回もの）は年を持たないので、
	// 生きている年とキーを共有したまま入れると、去年の「できた」が今年も済みになる。
	it('まだ登録されている年とキーがぶつかる doc は、いままでどおり振り直す', async () => {
		const year = Number(today.slice(0, 4));
		const docFor = (y: number) => ({
			child: CHILD,
			child_kana: CHILD,
			year: y,
			grade: '小2',
			period: {
				start: `${y}-07-21`,
				end: `${y}-08-31`,
				first_day_of_school: `${y}-09-01`
			},
			habits: [{ key: 'h_same', label: 'はみがき' }],
			school_start_items: [{ key: 'ss_same', label: 'なまえペン', due: `${y}-08-31` }]
		});
		await api.adminImportDefinition(docFor(year));
		const next = await api.adminImportDefinition(docFor(year + 1));

		const doc = next.doc as Record<string, { key: string }[]>;
		expect(doc.habits[0].key, '生きている年とキーを共有したまま入った').not.toBe('h_same');
		expect(doc.school_start_items[0].key, '「できた」が年をまたいで持ち越される').not.toBe(
			'ss_same'
		);
	});

	// えらぶ宿題の選択肢だけは、記録に載るキーの形が変わる（`グループ.選択肢`）。
	// doc に書かれた生の key（グループと選択肢が別々）を並べて比べると、この連結が
	// 見えないので、同じ文字列を key に持つ一回ものが素通りしてしまう。
	it('えらぶ宿題の選択肢と同じ形の key も、ぶつかりとして見る', async () => {
		const year = Number(today.slice(0, 4));
		// 生の key はどこも重ねない（重なると、実効キーを見なくても振り直しが走る）
		const base = (y: number) => ({
			child: CHILD,
			child_kana: CHILD,
			year: y,
			grade: '小2',
			period: {
				start: `${y}-07-21`,
				end: `${y}-08-31`,
				first_day_of_school: `${y}-09-01`
			},
			habits: [{ key: `h_${y}`, label: 'はみがき' }]
		});
		await api.adminImportDefinition({
			...base(year),
			choice_homework: [
				{ key: 'cg_x', label: 'どれかひとつ', options: [{ key: 'o_1', label: 'こうさく' }] }
			]
		});
		// 上の選択肢が flags に書くキーは 'cg_x.o_1'。同じ文字列を次の年が持っている
		const next = await api.adminImportDefinition({
			...base(year + 1),
			one_shot_homework: [{ key: 'cg_x.o_1', label: 'じゆうけんきゅう', required: false }]
		});

		const doc = next.doc as Record<string, { key: string }[]>;
		expect(
			doc.one_shot_homework[0].key,
			'去年の選択肢を押しただけで、今年の一回ものが済みになる'
		).not.toBe('cg_x.o_1');
	});
});

describe('やる／やらない', () => {
	// 標準テンプレートには「えらぶ宿題」も任意の一回ものも入っていないので、ここで足す。
	const doc = () => ({
		child: CHILD,
		child_kana: CHILD,
		year: Number(today.slice(0, 4)),
		grade: '小2',
		period: PERIOD,
		one_shot_homework: [{ key: 'os_free', label: 'じゆうけんきゅう', required: false }],
		choice_homework: [
			{
				key: 'cg_a',
				label: 'どれかひとつ',
				min_required: 1,
				options: [
					{ key: 'o_1', label: 'こうさく' },
					{ key: 'o_2', label: 'かんさつ' }
				]
			}
		]
	});

	it('「やらない」にすると、済みの印も消える（できたと やらない が同居しない）', async () => {
		await api.adminImportDefinition(doc());
		const state0 = await api.summerState(CHILD);
		const item = state0.one_shot[0];

		await api.summerToggleFlag(CHILD, item.key);
		expect((await api.summerState(CHILD)).one_shot[0].done).toBe(true);

		await api.summerSetDecision(CHILD, item.key, 'skip');
		const after = (await api.summerState(CHILD)).one_shot[0];
		expect(after.decision).toBe('skip');
		expect(after.done, '「やらない」なのに できた のまま').toBe(false);
		expect(after.value).toBe(0);
	});

	it('えらぶ宿題も同じで、満たした判定が残らない', async () => {
		await api.adminImportDefinition(doc());
		const group0 = (await api.summerState(CHILD)).choice_groups[0];
		const option = group0.options[0];

		await api.summerToggleFlag(CHILD, option.key);
		expect((await api.summerState(CHILD)).choice_groups[0].satisfied).toBe(true);

		await api.summerSetDecision(CHILD, option.key, 'skip');
		const group = (await api.summerState(CHILD)).choice_groups[0];
		expect(group.options[0].done).toBe(false);
		expect(group.satisfied, '「やらない」にしたのに満たしたまま').toBe(false);
	});

	it('全部「やらない」にはできない', async () => {
		await api.adminImportDefinition(doc());
		const group = (await api.summerState(CHILD)).choice_groups[0];
		await api.summerSetDecision(CHILD, group.options[0].key, 'skip');
		expect(api.summerSetDecision(CHILD, group.options[1].key, 'skip')).rejects.toThrow(
			'どれか1つはえらんでね'
		);
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

describe('バックアップの取り込み', () => {
	// 登録済みの状態から書き出す（呼ぶ側が先に wizard() すること）
	const goodPayload = async () => {
		const { payload } = await api.backupExportAll();
		return payload as Record<string, unknown>;
	};

	it('往復できる', async () => {
		await wizard();
		const payload = await goodPayload();
		await api.adminDeleteDefinition(CHILD);
		expect((await api.summerChildren()).children).toHaveLength(0);

		await api.backupImportAll(payload);
		expect((await api.summerChildren()).children).toHaveLength(1);
	});

	// 目印だけ合っていて中身が無いファイルで、いまの記録を空にしてはいけない。
	// 置きかえてしまうと、元の記録はもうどこにも無い。
	it('中身の無いファイルでは置きかえない', async () => {
		await wizard();
		const broken = { format: 'natsuyasumi-board/backup' };
		expect(api.backupImportAll(broken)).rejects.toThrow(/形式が読み取れません|中身が足りません/);
		expect((await api.summerChildren()).children, '記録が消えている').toHaveLength(1);
	});

	it('区画が欠けたファイルでも置きかえない', async () => {
		await wizard();
		const payload = await goodPayload();
		delete (payload.db as Record<string, unknown>).daily_checks;
		expect(api.backupImportAll(payload)).rejects.toThrow('中身が足りません');
		expect((await api.summerChildren()).children).toHaveLength(1);
	});

	// 「マップならよい」で通すと、置きかえたあとに一覧が row.child を読んで落ちる。
	// 記録を失ったうえにアプリが開けなくなるので、入れる前に断る。
	it('行の形が壊れているファイルは断る', async () => {
		await wizard();
		const payload = await goodPayload();
		(payload.db as Record<string, unknown>).definitions = { x: null };
		expect(api.backupImportAll(payload)).rejects.toThrow('読めない記録があります');
		expect((await api.summerChildren()).children).toHaveLength(1);

		// 断ったあとも、いままでどおり読める（壊れかけで止まっていない）
		expect((await api.summerState(CHILD)).child).toBe(CHILD);
	});

	it('新しいバージョンのファイルは断る', async () => {
		await wizard();
		const payload = await goodPayload();
		payload.version = 99;
		expect(api.backupImportAll(payload)).rejects.toThrow('新しいバージョン');
		expect((await api.summerChildren()).children).toHaveLength(1);
	});

	it('そもそもバックアップでないものは断る', async () => {
		await wizard();
		expect(api.backupImportAll({ child: 'はな' })).rejects.toThrow('バックアップのファイルではない');
	});
});

describe('バックアップの催促', () => {
	// 書き出して、そのファイルが手元にあると答えるところまで（画面の2段階を1本にしたもの）。
	// 通番は書き出したときのものを渡す——ここを「確かめた時点」にすると、待っている
	// あいだに付けたチェックまで済みに数える。
	const exportAndConfirm = async () => {
		const { ticket } = await api.backupExportAll();
		return api.backupMarkSaved(ticket);
	};

	// ここがこの機能のいちばん大事なところ。押しただけで「バックアップした」ことにすると、
	// 共有シートを閉じただけの親にも「さいごのバックアップ: きょう」と出て、催促が
	// 1週間消える。そのあいだに端末側の掃除で記録が消えると、戻す先がもう無い。
	it('書き出しただけでは「バックアップした」ことにしない', async () => {
		await wizard();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		const before = (await api.backupStatus()).changes_since_backup;

		await api.backupExportAll();

		const status = await api.backupStatus();
		expect(status.last_backup_at, '渡しただけで「バックアップした」ことになっている').toBeNull();
		expect(status.changes_since_backup, '確かめる前に催促が止まっている').toBe(before);
	});

	it('手元にあると答えたら「そのあと0件」（自分の書き込みを数えない）', async () => {
		await wizard();
		expect(await exportAndConfirm()).toEqual({ recorded: true });
		const status = await api.backupStatus();
		expect(status.changes_since_backup, '書き出しただけで「変わった」と言っている').toBe(0);
		expect(status.last_backup_at).not.toBeNull();
	});

	// 「確かめた時点」の通番で記録すると、この1件がファイルに入っていないのに
	// 済みに数えられる＝消えたときに戻せない分ができる。
	it('確かめるまでのあいだに付けたチェックは、ファイルに入っていないので数える', async () => {
		await wizard();
		const { ticket } = await api.backupExportAll();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		await api.backupMarkSaved(ticket);
		expect(
			(await api.backupStatus()).changes_since_backup,
			'書き出したあとのチェックが「バックアップ済み」に数えられている'
		).toBe(1);
	});

	// 復元は last_backup_seq をいまの通番に引き直す。そこへ古い書き出しの
	// 「ほぞんできた」が遅れて届いても、手元に無いファイルの分まで「まだ」に戻さない。
	it('復元したあとに古い「ほぞんできた」が届いても、基準を戻さない', async () => {
		await wizard();
		const { payload, ticket } = await api.backupExportAll();
		await api.backupImportAll(payload);

		expect(await api.backupMarkSaved(ticket), '古い書き出しで基準を書きかえている').toEqual({
			recorded: false
		});
		expect(
			(await api.backupStatus()).changes_since_backup,
			'復元した直後なのに「そのあと N件」と出ている'
		).toBe(0);
	});

	// 手元にあるファイルの通番のほうが先を指すことがある——保存が消えて作り直され、
	// 通番が 0 から振り直された端末（IndexedDB が使えずその場かぎりの置き場に落ちた、
	// サイトデータを消された）。ここで数を合わせにいくと、そのファイルには入っていない
	// 作り直したあとの記録まで「済み」に数える。催促は黙るのに、戻せる先はどこにも無い。
	it('手元の記録より先を指すファイルは、済みにしない', async () => {
		await wizard();
		const { ticket } = await api.backupExportAll();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		const before = (await api.backupStatus()).changes_since_backup;
		expect(before, '前提: 数えるものがある').toBeGreaterThan(0);

		expect(
			await api.backupMarkSaved({ ...ticket, seq: ticket.seq + 1000 }),
			'この記録の続きでないファイルで済みにしている'
		).toEqual({ recorded: false });
		expect(
			(await api.backupStatus()).changes_since_backup,
			'ファイルに入っていない分まで催促から消えている'
		).toBe(before);
	});

	// 世代の印は「この端末の保存が何代目か」なので、復元しても移行先の値が残る
	// （persisted などと同じ扱い）。出どころの端末の値を持ち込むと、向こうで書き出した
	// ファイルがこちらの記録の続きに見えてしまう。
	it('復元しても、世代の印はこの端末のものが残る', async () => {
		await wizard();
		const { payload, ticket } = await api.backupExportAll();
		const mine = await read((db) => db.meta.storage_id);
		expect(mine, '前提: 書き出しで世代の印が刻まれている').toBe(ticket.storage_id);

		// 別の端末で取ったバックアップ（世代の印が違う）から復元する
		((payload as Record<string, Record<string, { storage_id: string }>>).db.meta).storage_id =
			'べつの端末';
		await api.backupImportAll(payload);

		expect(await read((db) => db.meta.storage_id), '出どころの端末の印を持ち込んでいる').toBe(mine);
	});

	// 通番の大小だけでは世代を見分けられない。保存が作り直されると 0 から振り直されるので、
	// 入れ直した記録が、消される前に書き出したファイルの通番にそのうち追いつく。追いついた
	// あとは「先を指している」検査を素通りするため、無関係なファイルで済みにできてしまう。
	it('保存が作り直されたら、通番が届いていても済みにしない', async () => {
		await wizard();
		const { ticket } = await api.backupExportAll();

		// サイトデータを消された／IndexedDB が開けず作り直した、のあと入れ直した状況。
		// 通番は 0 から振り直され、ここでは書き出したときと同じところまで戻ってくる。
		setPersistence(memoryPersistence());
		await wizard();
		const before = (await api.backupStatus()).changes_since_backup;
		expect(before, '前提: 通番が書き出したときに追いついている').toBe(ticket.seq);

		expect(
			await api.backupMarkSaved(ticket),
			'消される前のファイルで、入れ直した記録まで済みにしている'
		).toEqual({ recorded: false });
		expect(
			(await api.backupStatus()).changes_since_backup,
			'ファイルに入っていない分まで催促から消えている'
		).toBe(before);
	});

	// 記録が変わらないうちに2つのタブで書き出すと、どちらの控えも同じ通番になる
	// ＝「先を指している」も「基準より古い」も引っかからない。新しいほうを確かめた
	// あとに古いほうの「ほぞんできた」が届いても、日づけを戻してはいけない
	// ——より新しいファイルが手元にあるのに、催促が早く出る。
	it('同じ通番の古いファイルを確かめても、日づけは戻さない', async () => {
		await wizard();
		const { ticket: older } = await api.backupExportAll();
		const { ticket: newer } = await api.backupExportAll();
		expect(newer.seq, '前提: 記録が変わっていないので通番は同じ').toBe(older.seq);

		// 新しいほうを先に確かめ、あとから古いほうの「ほぞんできた」が届く
		await api.backupMarkSaved(newer);
		const at = (await api.backupStatus()).last_backup_at;
		expect(
			await api.backupMarkSaved({ ...older, exported_at: older.exported_at - 600 }),
			'ちゃんと保存したのに断っている'
		).toEqual({ recorded: true });
		expect(
			(await api.backupStatus()).last_backup_at,
			'古いほうのファイルで日づけが戻っている'
		).toBe(at);
	});

	// 未来の日づけを抱えこむと、時計が直っても日数が0のまま張りつき、次に確かめても
	// 正しい時刻に上書きされない＝催促が二度と出ない。日づけを戻さない仕掛けが、
	// そのまま「間違った未来を守る」に化けないことを見る。
	it('未来の日づけは、確かめ直したときに引きずらない', async () => {
		await wizard();
		// 時計が進んでいた端末で取ったバックアップから復元した状況（復元は
		// last_backup_at を出どころのファイルから引き継ぐ）
		const { payload } = await api.backupExportAll();
		const ahead = nowEpochSec() + 365 * 86400;
		((payload as Record<string, Record<string, { last_backup_at: number }>>).db.meta)
			.last_backup_at = ahead;
		await api.backupImportAll(payload);
		expect((await api.backupStatus()).last_backup_at, '前提: 未来の日づけが入っている').toBe(ahead);

		// この端末で書き出して確かめ直せば、正しい「いま」に戻る
		await exportAndConfirm();
		expect(
			(await api.backupStatus()).last_backup_at,
			'間違った未来の日づけを抱えたままになっている'
		).toBeLessThanOrEqual(nowEpochSec());
	});

	// 未来の値を「いま」まで丸めて比べると、丸めた値がどのファイルの時刻でもないのに
	// 勝ってしまう。手元にあるのが3日前のファイルなら、日づけも3日前でなければ
	// ならない（「きょう」にすると、催促がそのぶん遅れる）。
	it('未来の日づけを、いまのファイルがある証拠にしない', async () => {
		await wizard();
		const { payload } = await api.backupExportAll();
		const ahead = nowEpochSec() + 365 * 86400;
		((payload as Record<string, Record<string, { last_backup_at: number }>>).db.meta)
			.last_backup_at = ahead;
		await api.backupImportAll(payload);

		// 復元したあとに書き出して、そのまま3日置いてから「ほぞんできた」を押した
		const { ticket } = await api.backupExportAll();
		const threeDaysAgo = nowEpochSec() - 3 * 86400;
		await api.backupMarkSaved({ ...ticket, exported_at: threeDaysAgo });

		expect(
			(await api.backupStatus()).last_backup_at,
			'3日前のファイルしか無いのに「きょう」になっている'
		).toBe(threeDaysAgo);
	});

	// 催促が測っているのは「手元のファイルの古さ」。確かめた時刻で刻むと、問いかけを
	// 開いたまま何日も置いてから答えたときに、1週間前のファイルが「きょう」になる
	// ——次の催促がそこからさらに遅れる。
	// 控えの中身そのものを1度は見ておく。ほかの検査はどれも exported_at を差し替えてから
	// 渡しているので、書き出しがここに何を入れていても（0 でも、別の欄でも）通ってしまう。
	it('控えには、書き出したその時刻が入っている', async () => {
		await wizard();
		const before = nowEpochSec();
		const { ticket } = await api.backupExportAll();
		const after = nowEpochSec();

		expect(ticket.exported_at, '書き出した時刻が入っていない').toBeGreaterThanOrEqual(before);
		expect(ticket.exported_at).toBeLessThanOrEqual(after);
		// そのまま渡せば、その時刻がそのまま刻まれる（丸めも読み替えもされない）
		await api.backupMarkSaved(ticket);
		expect((await api.backupStatus()).last_backup_at).toBe(ticket.exported_at);
	});

	it('日づけは、確かめた時刻ではなく書き出した時刻', async () => {
		await wizard();
		const { ticket } = await api.backupExportAll();
		const threeDaysAgo = nowEpochSec() - 3 * 86400;
		await api.backupMarkSaved({ ...ticket, exported_at: threeDaysAgo });
		expect(
			(await api.backupStatus()).last_backup_at,
			'確かめた時刻で刻んでいる（古いファイルが「きょう」になる）'
		).toBe(threeDaysAgo);

	});

	// 書き出したときは時計が進んでいて、そのあと直った、という控え。時刻が決めようが
	// ないので受け取らない。「いま」まで丸めると、何日も前のファイルが「きょう作った」
	// ことになり、催促がそのぶん遅れる（丸めた値は、どのファイルの時刻でもない）。
	it('先の時刻を指す控えは、いまに丸めずに断る', async () => {
		await wizard();
		const { ticket } = await api.backupExportAll();
		const before = await api.backupStatus();

		expect(
			await api.backupMarkSaved({ ...ticket, exported_at: nowEpochSec() + 3 * 86400 }),
			'日づけの決められない控えで済みにしている'
		).toEqual({ recorded: false });

		const after = await api.backupStatus();
		expect(after.last_backup_at, '当てにならない時刻を刻んでいる').toBe(before.last_backup_at);
		expect(after.changes_since_backup, '断ったのに基準だけ動いている').toBe(
			before.changes_since_backup
		);
	});

	it('そのあとチェックすると数が増える', async () => {
		await wizard();
		await exportAndConfirm();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		expect((await api.backupStatus()).changes_since_backup).toBe(1);
	});

	// 記録以外の書き込みまで数えると、何もしていないのに件数だけ積み上がって
	// 「バックアップをおすすめします」に昇格する＝催促が当てにならなくなる。
	it('端末の事情を書いただけでは数が増えない', async () => {
		await wizard();
		await exportAndConfirm();
		await api.backupDismissHomeHint();
		expect(
			(await api.backupStatus()).changes_since_backup,
			'案内を閉じただけで「そのあと1件」と出る'
		).toBe(0);

		// 記録のほうは、そのあとも数えられていること（数え落としに倒れていない）
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		expect((await api.backupStatus()).changes_since_backup).toBe(1);
	});

	// 数えかたは「seq の増分」ひとつきり、というのを固定する。
	//
	// 記録の変更ぶんを別の欄に数え上げる作りにすると、その欄を知らない版
	// （Service Worker のキャッシュに残った古いタブ、配信の切り戻し）が書いた分が
	// まるごと催促から消える。逆に内部の書き込みを別の欄に数えて引く作りにすると、
	// 古い版が書き出したときに基準の片方だけが更新されて、そのあとの変更を過少に数える。
	// どちらの版が書いても物差しが1本なら、そのどちらも起きない。
	it('通番を上げるだけの版が書いた分も、そのまま数える', async () => {
		const store = pokeablePersistence();
		setPersistence(store);
		await wizard();
		await exportAndConfirm();

		// 古い版のタブが31回書いた状況
		const stale = await read((db) => JSON.parse(JSON.stringify(db)) as Db);
		stale.meta.seq += 31;
		store.poke(stale);
		setPersistence(store); // 手元の写しを捨てて、保存から読み直させる

		expect(
			(await api.backupStatus()).changes_since_backup,
			'古い版が書いた分が催促から消えている'
		).toBe(31);
	});

	it('古い版が書き出したあとの変更も、取りこぼさず数える', async () => {
		const store = pokeablePersistence();
		setPersistence(store);
		await wizard();
		await exportAndConfirm();
		// 書き出したあとで、この端末の事情を書く（ホームの案内を閉じた。通番は上がらない）
		await api.backupDismissHomeHint();

		// 古い版のタブが書き出した状況。あちらは last_backup_at と last_backup_seq を
		// 今の通番に置き直すだけで、こちらが足した仕掛けのことは知らない。
		const exported = await read((db) => JSON.parse(JSON.stringify(db)) as Db);
		exported.meta.last_backup_at = nowEpochSec();
		exported.meta.last_backup_seq = exported.meta.seq;
		store.poke(exported);
		setPersistence(store);
		expect((await api.backupStatus()).changes_since_backup, '書き出した直後なのに増えている').toBe(
			0
		);

		// そのあとの記録は1件目から数えられること（基準がずれていると先頭が飲み込まれる）
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		expect(
			(await api.backupStatus()).changes_since_backup,
			'古い版の書き出しのあと、変更が過少に数えられている'
		).toBe(1);
	});
});

// 書き出したあと、親が「ほぞんできた」と答えるまでのあいだの話。
//
// この問いかけを画面の中だけに持っていたころ、設定画面を離れると聞く口ごと消えていた。
// iPhone では共有シートやプレビューから「もどる」だけでそうなる。書き出しは日づけを
// 刻まない作りなので、答える口が消えると、ファイルは端末にあるのに
// 「まだバックアップしていません」が二度と引っ込まない。だから保存に残す。
describe('書き出しの控えを保存に残す', () => {
	/** 書き出して、ブラウザに渡せたところまで（画面が downloadJson のあとに呼ぶ流れ）。 */
	const exportAndNote = async () => {
		const { filename, payload, ticket } = await api.backupExportAll();
		await api.backupNotePending({ ticket, filename });
		return { filename, payload, ticket };
	};

	// この機能の本体。保存から読み直しても問いかけが残っていること。
	it('開き直しても、聞きそびれた問いかけは残っている', async () => {
		const store = pokeablePersistence();
		setPersistence(store);
		await wizard();
		const { ticket, filename } = await exportAndNote();

		setPersistence(store); // 手元の写しを捨てて、保存から読み直させる

		expect(
			(await api.backupStatus()).pending_backup,
			'開き直したら、答える口が消えている'
		).toEqual({ ticket, filename });
	});

	// 入ったまま別の端末で復元されると、一度も書き出していない端末に、しかも別世代の
	// 印を持つ問いかけが出る（答えても保存側が断るだけ）。
	it('書き出したファイルに、問いかけは入らない', async () => {
		await wizard();
		await exportAndNote(); // 1回目の控えが保存に残っている状態にしてから

		const { payload } = await api.backupExportAll();

		expect(
			(payload as { db: Db }).db.meta.pending_backup,
			'書き出したファイルに、この端末の問いかけが乗っている'
		).toBeNull();
	});

	it('「ほぞんできた」を記録したら、問いかけは下がる', async () => {
		await wizard();
		const { ticket } = await exportAndNote();

		expect(await api.backupMarkSaved(ticket)).toEqual({ recorded: true });
		expect((await api.backupStatus()).pending_backup, '答えたのにまだ聞いてくる').toBeNull();
	});

	// 断ったときに問いかけを残すと、押しても同じ理由で断られるだけ。画面は書き出し直しを
	// 促しているので、問いかけのほうは下げる。
	it('受け取れなかったときも、問いかけは下がる', async () => {
		await wizard();
		const { ticket } = await exportAndNote();

		expect(await api.backupMarkSaved({ ...ticket, storage_id: 'ほかの世代' })).toEqual({
			recorded: false
		});
		const status = await api.backupStatus();
		expect(status.pending_backup).toBeNull();
		expect(status.last_backup_at, '断ったのに日づけを刻んでいる').toBeNull();
	});

	it('「できていない」は、問いかけを下げるだけで催促を動かさない', async () => {
		await wizard();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');
		await exportAndNote();
		const before = (await api.backupStatus()).changes_since_backup;

		await api.backupDismissPending();

		const status = await api.backupStatus();
		expect(status.pending_backup).toBeNull();
		expect(status.last_backup_at, '「できていない」なのに日づけを刻んでいる').toBeNull();
		expect(
			status.changes_since_backup,
			'問いかけを下げただけで「そのあと N件」が増えている'
		).toBe(before);
	});

	it('もう一度書き出したら、問いかけは新しいほうに置きかわる', async () => {
		await wizard();
		await exportAndNote();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done'); // 通番を進める
		const second = await exportAndNote();

		expect((await api.backupStatus()).pending_backup, '古いほうの問いかけが残っている').toEqual({
			ticket: second.ticket,
			filename: second.filename
		});
	});

	// 復元は基準をいまの通番へ引き直すので、その前に書き出したファイルはもう受け取れない。
	it('復元したら、問いかけは落ちる', async () => {
		await wizard();
		const { payload } = await exportAndNote();

		await api.backupImportAll(payload);

		expect(
			(await api.backupStatus()).pending_backup,
			'復元したのに、答えても断られる問いかけが残っている'
		).toBeNull();
	});

	// この欄を知らない版のタブ（Service Worker のキャッシュに残ったもの）が
	// 「ほぞんできた」を記録すると、基準だけが先へ進んで控えは残る。
	it('もう受け取れない控えは、問いかけとして出さない', async () => {
		const store = pokeablePersistence();
		setPersistence(store);
		await wizard();
		await exportAndNote();

		const advanced = await read((db) => JSON.parse(JSON.stringify(db)) as Db);
		advanced.meta.seq += 5;
		advanced.meta.last_backup_seq = advanced.meta.seq;
		advanced.meta.last_backup_at = nowEpochSec();
		store.poke(advanced);
		setPersistence(store);

		expect(
			(await api.backupStatus()).pending_backup,
			'押しても断られるだけの問いかけを出している'
		).toBeNull();
	});

	it('この欄を知らない保存から読んでも落ちない', async () => {
		const store = pokeablePersistence();
		setPersistence(store);
		await wizard();

		const old = await read((db) => JSON.parse(JSON.stringify(db)) as Db);
		delete (old.meta as unknown as Record<string, unknown>).pending_backup;
		store.poke(old);
		setPersistence(store);

		expect((await api.backupStatus()).pending_backup).toBeNull();
	});
});

describe('編集用に渡す定義は写しであること', () => {
	// 管理画面は受け取った doc を直接書き換える作り。実体をそのまま渡すと、
	// 保存を押す前の編集が生きているデータに入る。
	it('受け取った doc を書き換えても、保存されている中身は変わらない', async () => {
		await wizard();
		// 触る前の数を先に控える（比べる相手も書き換わっていては検査にならない）
		const before = ((await api.adminGetDefinition(CHILD)).doc as Record<string, unknown[]>).habits
			.length;

		const entry = await api.adminGetDefinition(CHILD);
		(entry.doc as Record<string, unknown[]>).habits = [];

		const again = (await api.adminGetDefinition(CHILD)).doc as Record<string, unknown[]>;
		expect(again.habits.length, '保存していない編集が残っている').toBe(before);
	});

	it('子どもの画面が、保存していない編集を先に映さない', async () => {
		await wizard();
		const before = (await api.summerState(CHILD)).habits.length;
		const entry = await api.adminGetDefinition(CHILD);
		(entry.doc as Record<string, unknown[]>).habits = [];

		expect((await api.summerState(CHILD)).habits.length, '子どもの画面から項目が消えた').toBe(
			before
		);
	});

	// いちばん重い症状。比較相手まで編集後の姿になると、警告が鳴らないまま保存できる。
	it('記録のある項目を消すと、ちゃんと警告が出る', async () => {
		await wizard();
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');

		const entry = await api.adminGetDefinition(CHILD);
		const doc = entry.doc as Record<string, { key: string }[]>;
		doc.habits = doc.habits.filter((h) => h.key !== k.habits[0]);

		const result = await api.adminValidateDefinition(CHILD, entry.doc);
		const codes = result.warnings.map((w) => w.code);
		expect(codes, '記録のある項目を消したのに警告が出ない').toContain('delete_with_records');
	});
});

describe('検証は編集中の年で比べる', () => {
	it('去年を開いて直しても、今年の記録を根拠にした警告は出ない', async () => {
		await wizard();
		const thisYear = Number(today.slice(0, 4));

		// 今年ぶんに記録を1つ入れておく（この記録が去年の検証に混ざると誤警告になる）
		const k = await keysOf();
		await api.summerSetCheck(CHILD, today, k.habits[0], 'done');

		// 去年ぶんの定義を別に作る（期間も去年）
		const lastYear = thisYear - 1;
		await api.adminImportDefinition({
			child: CHILD,
			child_kana: CHILD,
			year: lastYear,
			grade: '小1',
			period: {
				start: `${lastYear}-07-21`,
				end: `${lastYear}-08-31`,
				first_day_of_school: `${lastYear}-09-01`
			},
			habits: [{ key: 'h_old', label: 'はみがき' }]
		});

		const lastYearDoc = (await api.adminGetDefinition(CHILD, lastYear)).doc;
		const result = await api.adminValidateDefinition(CHILD, lastYearDoc);
		const codes = result.warnings.map((w) => w.code);
		expect(codes, '今年の記録や項目を根拠にした警告が混ざっている').not.toContain(
			'records_outside_period'
		);
		expect(codes).not.toContain('delete_with_records');
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

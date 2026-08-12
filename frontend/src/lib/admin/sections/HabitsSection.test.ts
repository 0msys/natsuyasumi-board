// 「記録欄を出す日」を切り替えたときに、画面から見えなくなる日付を doc に残さないこと。
//
// 日付欄は window === 'range' のときしか描かない。検証も range のときしか日付を見ないので、
// 残した空文字は「親からは見えないのに保存されてしまう値」になり、あとで「来年ぶんを作る」の
// 年ずらしがそれを読んで落ちていた。メモ欄の種類（DailyHomeworkSection）と一回ものの目標数は
// 逆に「種類を変えても元の設定値を残す」——あちらは種類を戻せば入力欄がまた画面に出るので、
// 残った値を親が確かめて直せる。ここだけ扱いが違う理由をテストにも残しておく。
import { beforeEach, describe, expect, it } from 'bun:test';
import { render } from '@testing-library/svelte';
import { setApi } from '../../../test-support/apiMock';

const HabitsSection = (await import('./HabitsSection.svelte')).default;
const { AdminDraft } = await import('../draft.svelte');

/** 本物の AdminDraft を使う（doc は $state の深いプロキシ＝書き換えが再描画に伝わる）。
 *  素のオブジェクトをスタブにすると、日付欄が消えたかどうかを見られない。 */
function mount(habit: Record<string, unknown>) {
	const draft = new AdminDraft();
	draft.initFrom({
		child: 'はな',
		year: 2026,
		revision: 1,
		doc: { child: 'はな', child_kana: 'はな', habits: [habit] }
	} as never);
	const r = render(HabitsSection, {
		props: { draft, gradeLevel: 2, nameExceptions: '', usage: {} }
	});
	return { r, draft };
}

const click = (r: { container: HTMLElement }, label: string) =>
	[...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();

const dateInputs = (r: { container: HTMLElement }) =>
	r.container.querySelectorAll('input[type="date"]');

/** きかん限定で、日付まで入っている習慣。 */
const ranged = () => ({
	key: 'h_1',
	label: 'ラジオたいそう',
	window: 'range',
	window_start: '2026-07-21',
	window_end: '2026-07-24'
});

beforeEach(() => {
	// ラベル欄（RubyTextInput）が配当漢字のライブ lint を取りに行く
	setApi({ adminKanji: async () => ({ grades: {} }) });
});

describe('記録欄を出す日', () => {
	it('「毎日」へ戻すと、見えなくなる日付は doc から消える', async () => {
		const { r, draft } = mount(ranged());
		expect(dateInputs(r)).toHaveLength(2);

		click(r, '毎日');
		expect(draft.doc!.habits![0].window).toBeNull();
		expect(draft.doc!.habits![0].window_start).toBeUndefined();
		expect(draft.doc!.habits![0].window_end).toBeUndefined();

		await r.rerender({});
		expect(dateInputs(r)).toHaveLength(0); // 直す手段の無い値は残っていない
	});

	it('「はじめとおわりだけ」へ変えたときも日付は消える', () => {
		const { r, draft } = mount(ranged());
		click(r, 'はじめとおわりだけ');
		expect(draft.doc!.habits![0].window).toBe('edges');
		expect(draft.doc!.habits![0].window_start).toBeUndefined();
		expect(draft.doc!.habits![0].window_end).toBeUndefined();
	});

	it('「きかん限定」にすると空の日付欄が出る（未入力は検証が止めるので親が気づける）', async () => {
		const { r, draft } = mount({ key: 'h_1', label: 'ラジオたいそう', window: null });
		expect(dateInputs(r)).toHaveLength(0);

		click(r, 'きかん限定');
		expect(draft.doc!.habits![0].window_start).toBe('');
		expect(draft.doc!.habits![0].window_end).toBe('');

		await r.rerender({});
		expect(dateInputs(r)).toHaveLength(2);
	});
});

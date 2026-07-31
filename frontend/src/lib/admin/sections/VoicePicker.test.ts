// 「ためし聞き」まわりの、読むだけでは確かめにくい挙動を描画して固定する。
//
//   - 一覧に無い話者ID（よその家の定義を取り込んだ等）は直接指定せず、サーバの既定に任せる
//     ＝子どもページでは鳴るのに試聴だけ 400、という食い違いを作らない
//   - その状態から「きほんのこえ」へ戻せる（専用の option が無いと change が発火せず戻せない）
//   - 合成を待つあいだに こえ を えらび直した／この欄が消えたら、前の こえ を鳴らさない
//
// speakText は差し替えず本物を通す。差し替えると、本物を検査している speakText.test.ts を
// 巻き添えにする（bun の mock.module はプロセス全体に効く）。差し替えるのは末端だけ
// ＝ api.ttsBlob と $lib/ttsAudio で、どちらも test-support に集約してある。
// おかげでこのテストは「押してから音が出るまで」を通しで見ることになる。
import { beforeEach, describe, expect, it } from 'bun:test';
import { render } from '@testing-library/svelte';
import { setApi } from '../../../test-support/apiMock';
import { playedAudio, resetBrowserMocks } from '../../../test-support/browserMocks';

const speakersPayload = {
	available: true,
	default_speaker: 3,
	speakers: [
		{ name: 'ずんだもん', styles: [{ id: 3, name: 'ノーマル' }] },
		{ name: '春日部つむぎ', styles: [{ id: 8, name: 'ノーマル' }] }
	]
};

// 合成の応答を返す時点をテスト側で決める（待っているあいだに操作するため）
const synthesized: { speaker?: number }[] = [];
let releaseBlob: (() => void) | null = null;

const ttsBlob = (_text: string, opts: { speaker?: number } = {}) => {
	synthesized.push(opts);
	return new Promise<Blob>((resolve) => {
		releaseBlob = () => resolve(new Blob(['wav']));
	});
};

const VoicePicker = (await import('./VoicePicker.svelte')).default;
const { AdminDraft } = await import('../draft.svelte');

/** 本物の AdminDraft を使う（doc は $state の深いプロキシ＝差し替えが再計算に伝わる）。
 *  素のオブジェクトをスタブにすると doc.voice を書き換えても $derived が更新されず、
 *  「えらび直したら鳴らさない」の検査が通ってしまう＝空虚なテストになる。 */
function draftWith(voice: { speaker: number; label?: string } | undefined) {
	const draft = new AdminDraft();
	draft.initFrom({
		child: 'はな',
		year: 2026,
		revision: 1,
		doc: { child: 'はな', child_kana: 'はな', ...(voice ? { voice } : {}) }
	} as never);
	return draft;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountPicker(voice: { speaker: number; label?: string } | undefined) {
	const draft = draftWith(voice);
	const r = render(VoicePicker, { props: { draft } });
	await flush(); // onMount の ttsSpeakers を解決させる
	await r.rerender({});
	return { r, draft };
}

const buttonWith = (r: { container: HTMLElement }, label: string) =>
	[...r.container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));

beforeEach(() => {
	resetBrowserMocks();
	synthesized.length = 0;
	releaseBlob = null;
	setApi({ ttsSpeakers: async () => speakersPayload, ttsBlob });
});

describe('ためし聞き', () => {
	it('一覧にある こえ はそのIDで鳴らす', async () => {
		const { r } = await mountPicker({ speaker: 8, label: '春日部つむぎ（ノーマル）' });
		buttonWith(r, 'ためし聞き')!.click();
		await flush();
		expect(synthesized[0].speaker).toBe(8);

		releaseBlob!();
		await flush();
		expect(playedAudio).toHaveLength(1);
	});

	it('一覧に無い こえ はIDを送らない（サーバの既定に落として鳴らす）', async () => {
		// 子どもページはサーバ側のフォールバックで鳴る。試聴だけ 400 にしない。
		const { r } = await mountPicker({ speaker: 999, label: 'よその家の声' });
		buttonWith(r, 'ためし聞き')!.click();
		await flush();
		expect(synthesized[0].speaker).toBeUndefined();
	});

	it('一覧に無い こえ から「きほんのこえ」へ戻せる', async () => {
		const { r, draft } = await mountPicker({ speaker: 999, label: 'よその家の声' });
		expect(draft.doc!.voice).toBeDefined();
		buttonWith(r, 'きほんのこえに もどす')!.click();
		expect(draft.doc!.voice).toBeUndefined();
	});

	it('待っているあいだに こえ を えらび直したら鳴らさない', async () => {
		const { r, draft } = await mountPicker({ speaker: 8, label: '春日部つむぎ（ノーマル）' });
		buttonWith(r, 'ためし聞き')!.click();
		await flush();

		// 合成が返る前に別の こえ へ変更
		draft.doc!.voice = { speaker: 3, label: 'ずんだもん（ノーマル）' };
		await r.rerender({});

		releaseBlob!();
		await flush();
		expect(playedAudio).toEqual([]); // 前の こえ は鳴らない
	});

	it('この欄が画面から消えたあとは鳴らさない', async () => {
		// 別タブへ切替・ほかの子へ移動・管理画面から離脱。もう見ていない画面の音を出さない
		// （破棄後の $derived を読まないよう、destroyed を先に見ていることの検査でもある）。
		const { r } = await mountPicker({ speaker: 8, label: '春日部つむぎ（ノーマル）' });
		buttonWith(r, 'ためし聞き')!.click();
		await flush();

		r.unmount();
		releaseBlob!();
		await flush();
		expect(playedAudio).toEqual([]);
	});
});

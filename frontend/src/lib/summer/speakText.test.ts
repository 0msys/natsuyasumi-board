// 試聴（previewVoice）の「追い越された合成は鳴らさない」だけを固定する。
//
// 合成には数秒かかり、そのあいだ管理画面の こえ の select は操作できる。返ってきた
// blob をそのまま再生すると、えらび直したあとに前の こえ が鳴って、画面の表示と
// 聞こえる声が食い違う（しかも利用者は「この声だ」と誤解して保存する）。
// 判定は再生の直前で行う必要がある——呼び出し側が await のあとに確かめても、
// そのときにはもう鳴っている。その順序をここで固定する。
import { beforeEach, describe, expect, it } from 'bun:test';
import { setApi } from '../../test-support/apiMock';
import { playedAudio as played, resetBrowserMocks } from '../../test-support/browserMocks';

let pendingBlob: ((b: Blob) => void) | null = null;
let failBlob: ((e: Error) => void) | null = null;
const requested: { speaker?: number }[] = [];

const ttsBlob = (_text: string, opts: { speaker?: number } = {}) => {
	requested.push(opts);
	return new Promise<Blob>((resolve, reject) => {
		pendingBlob = resolve;
		failBlob = reject;
	});
};

const { previewVoice, speakSummerText, setTtsAvailability } = await import('./speakText');

beforeEach(() => {
	resetBrowserMocks();
	requested.length = 0;
	pendingBlob = null;
	failBlob = null;
	setApi({ ttsBlob });
});

describe('previewVoice', () => {
	it('合成の完了時にまだ同じ こえ が選ばれていれば鳴らす', async () => {
		const done = previewVoice('やあ', 8, () => true);
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(played.length).toBe(1);
	});

	it('待っているあいだに こえ を えらび直したら鳴らさない', async () => {
		let selected = 8;
		const done = previewVoice('やあ', 8, () => selected === 8);
		selected = 3; // 合成を待つあいだに select が動いた
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(played.length).toBe(0); // 前の こえ が後から鳴らない
	});

	it('shouldPlay を渡さなければ従来どおり鳴らす（子どもページの読み上げ経路）', async () => {
		const done = previewVoice('やあ');
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(played.length).toBe(1);
	});

	it('speaker 未指定なら直接指定を送らない（サーバの既定＝実在検査つきに任せる）', async () => {
		const done = previewVoice('やあ');
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(requested[0]).toEqual({});
	});

	it('合成の失敗は呼び出し側へ投げる（画面が案内を出し分けられるように）', async () => {
		const done = previewVoice('やあ', 8, () => true);
		failBlob!(new Error('/api/tts → 400 この声では合成できません'));
		expect(done).rejects.toThrow('→ 400');
	});
});

describe('speakSummerText', () => {
	beforeEach(() => setTtsAvailability(true));

	it('待っているあいだに子どもが切り替わったら鳴らさない', async () => {
		// /?child=… は同じルート内のクライアント遷移なので、合成中に対象が変わりうる。
		// 前の子あてのコメントが、切り替えた先の画面で前の子の声で鳴ってはいけない。
		let current = 'はな';
		const done = speakSummerText('よくできたね', 'はな', () => current === 'はな');
		current = 'そら';
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(played.length).toBe(0);
	});

	it('同じ子のままなら鳴らす', async () => {
		const done = speakSummerText('よくできたね', 'はな', () => true);
		pendingBlob!(new Blob(['wav']));
		await done;
		expect(played.length).toBe(1);
	});

	it('VOICEVOX が使えないときは合成そのものを頼まない（無音縮退）', async () => {
		setTtsAvailability(false);
		await speakSummerText('よくできたね', 'はな', () => true);
		expect(requested.length).toBe(0);
		expect(played.length).toBe(0);
	});
});

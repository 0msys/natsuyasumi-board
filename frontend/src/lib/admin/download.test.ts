// 「ブラウザに渡す」ところの作法を固定する。
//
// この関数にできるのは渡すところまでで、ファイルが端末に残ったかは分からない。だから
// 壊れかたも静かで、押しても何も起きないのに例外も出ない——issue #3 で踏んだのはその形。
// 確かめようがない側は確かめないかわりに、渡しかた（規格どおりに押しているか）と、
// 親が押し直せる url が生きていることだけは、ここで押さえておく。
//
// 本物のクリックは走らせない。happy-dom の <a download> は内部で遷移を起こそうとするので、
// 後続のテストに location が漏れる。押された瞬間の姿だけ控える。
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { downloadJson } from './download';

type Pressed = { connected: boolean; download: string; href: string };

let pressed: Pressed[] = [];
let revoked: string[] = [];
let created: Blob[] = [];
let spies: { mockRestore: () => void }[] = [];

beforeEach(() => {
	pressed = [];
	revoked = [];
	created = [];
	const realCreate = document.createElement.bind(document);
	spies = [
		spyOn(document, 'createElement').mockImplementation(((tag: string) => {
			const el = realCreate(tag);
			if (tag === 'a') {
				const a = el as HTMLAnchorElement;
				a.click = () => pressed.push({ connected: a.isConnected, download: a.download, href: a.href });
			}
			return el;
		}) as never),
		spyOn(URL, 'createObjectURL').mockImplementation(((blob: Blob) => {
			created.push(blob);
			return `blob:test-${created.length}`;
		}) as never),
		spyOn(URL, 'revokeObjectURL').mockImplementation(((url: string) => {
			revoked.push(url);
		}) as never)
	];
});

afterEach(() => {
	spies.forEach((s) => s.mockRestore());
});

describe('JSON をファイルとして渡す', () => {
	// どこにも属していない <a> のクリックを無視するブラウザがある。見た目は何も起きず、
	// 例外も出ず、click は document まで上がってこないので誰も気づけない。
	it('画面に入れてから押す', () => {
		downloadJson('a.json', { x: 1 });
		expect(pressed).toHaveLength(1);
		expect(pressed[0].connected, 'どこにも属していない <a> を押している').toBe(true);
	});

	it('ファイル名をそのまま download に載せる', () => {
		downloadJson('2026-はな.json', { x: 1 });
		expect(pressed[0].download).toBe('2026-はな.json');
	});

	// 押したあとすぐ解放すると、親が押し直すためのリンクが死ぬ（押しても何も起きない
	// リンクは、手がかりとしてはむしろ悪い）。
	it('押したあとも url は生きている', () => {
		const handle = downloadJson('a.json', { x: 1 });
		expect(handle.url).toBe(pressed[0].href);
		expect(revoked, '渡したそばから解放している').toEqual([]);
	});

	it('release() で解放する（2回呼んでも1回だけ）', () => {
		const handle = downloadJson('a.json', { x: 1 });
		handle.release();
		handle.release();
		expect(revoked).toEqual([handle.url]);
	});

	// 呼ぶ側が「出せた」と扱わないよう、組み立てで転んだら投げる。
	it('組み立てられないものは投げる（黙って成功にしない）', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => downloadJson('a.json', circular)).toThrow();
		expect(pressed, '中身を組み立てられていないのに押している').toEqual([]);
	});

	it('渡すのは JSON の中身そのもの', async () => {
		downloadJson('a.json', { x: 1 });
		expect(created).toHaveLength(1);
		expect(created[0].type).toBe('application/json');
		expect(JSON.parse(await created[0].text())).toEqual({ x: 1 });
	});
});

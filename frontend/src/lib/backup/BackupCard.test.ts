// 「押した」と「手元にある」を、このカードが混ぜないことを実際に描画して固定する。
//
// 催促の赤い印は、記録が消えたときに戻せるようにするための仕組み。押しただけで
// 「さいごのバックアップ: きょう」になると、共有シートを閉じた親のところでも印が
// 1週間消え、そのあいだに端末側の掃除で記録が消えると戻す先がもう無い（issue #3）。
// 「ほぞんできた」を押すまで基準を進めない、という一本道はここでしか作れないので、
// 読むだけでなく描いて確かめる。
//
// 本物の <a download> クリックは走らせない（happy-dom が遷移を起こして後続に漏れる）。
// download.test.ts と同じく、押された瞬間の姿だけ控える。
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { setApi } from '../../test-support/apiMock';
import type { BackupStatus, BackupTicket, PendingBackup } from '$lib/api';

const BackupCard = (await import('./BackupCard.svelte')).default;

/** マイクロタスクと $effect の後始末が一巡するのを待つ。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 同じ書き出しの控えか（保存側の sameBackupFile と同じ判定を、モックの中でも使う）。 */
const sameTicket = (a: BackupTicket | undefined, b: BackupTicket): boolean =>
	!!a && a.seq === b.seq && a.exported_at === b.exported_at && a.storage_id === b.storage_id;

const STATUS: BackupStatus = {
	supported: true,
	last_backup_at: null,
	changes_since_backup: 3,
	pending_backup: null,
	persisted: true,
	storage_ephemeral: false,
	home_hint_dismissed: true
};

let status: BackupStatus;
/** backupMarkSaved に渡された控え（呼ばれた順）. */
let marked: BackupTicket[];
/** backupNotePending に渡された問いかけ（呼ばれた順）. */
let noted: PendingBackup[];
/** backupDismissPending に渡された控え（呼ばれた順）. */
let dismissed: BackupTicket[];
/** backupMarkSaved の答え（既定は「進めた」）. */
let markRecorded: boolean;
let exportSeq: number;
/** 書き出した時刻（催促の日づけはこれで刻まれる）. */
let exportedAt: number;
let spies: { mockRestore: () => void }[] = [];
/** 作った blob URL と、解放した blob URL（数が合わないと記録まるごとの写しが残る）. */
let created: string[];
let revoked: string[];
/** true にすると書き出しの応答を止める（往復の途中を作る）. */
let holdExport: boolean;
/** 止めた応答を返させる（テストが呼ぶ）. */
let releaseExport: (() => void) | null;

beforeEach(() => {
	cleanup();
	status = { ...STATUS };
	marked = [];
	noted = [];
	dismissed = [];
	markRecorded = true;
	exportSeq = 7;
	exportedAt = 1_785_900_000;
	created = [];
	revoked = [];
	holdExport = false;
	releaseExport = null;
	setApi({
		backupStatus: async () => ({ ...status }),
		backupExportAll: async () => {
			// 止めておくときは、返す時点をテスト側が決める（往復の途中に割り込むため）
			if (holdExport) await new Promise<void>((resolve) => (releaseExport = resolve));
			return {
				filename: 'natsuyasumi-board-2026-08-09.json',
				payload: { db: {} },
				ticket: { seq: exportSeq, exported_at: exportedAt, storage_id: 'gen-1' }
			};
		},
		// 本物と同じ因果にしておく（問いかけを立てるのは書き出しではなく、こちら）。
		backupNotePending: async (pending: PendingBackup) => {
			noted.push(pending);
			status = { ...status, pending_backup: pending };
		},
		// 本物と同じく、答えられたファイルの問いかけだけを下げる（別のタブが後から書き出して
		// いたら、そちらは残る）。
		backupDismissPending: async (ticket: BackupTicket) => {
			dismissed.push(ticket);
			if (sameTicket(status.pending_backup?.ticket, ticket)) {
				status = { ...status, pending_backup: null };
			}
		},
		backupMarkSaved: async (ticket: BackupTicket) => {
			marked.push(ticket);
			// 受け取れたかどうかによらず、答えられたファイルの問いかけは下がる（保存側と同じ）。
			if (sameTicket(status.pending_backup?.ticket, ticket)) {
				status = { ...status, pending_backup: null };
			}
			if (markRecorded) {
				status = { ...status, last_backup_at: 1_786_000_000, changes_since_backup: 0 };
			}
			return { recorded: markRecorded };
		},
		backupDismissHomeHint: async () => {}
	});
	const realCreate = document.createElement.bind(document);
	spies = [
		spyOn(document, 'createElement').mockImplementation(((tag: string) => {
			const el = realCreate(tag);
			if (tag === 'a') (el as HTMLAnchorElement).click = () => {};
			return el;
		}) as never),
		spyOn(URL, 'createObjectURL').mockImplementation(((() => {
			created.push(`blob:test-${created.length + 1}`);
			return created[created.length - 1];
		}) as unknown) as never),
		spyOn(URL, 'revokeObjectURL').mockImplementation(((url: string) => {
			revoked.push(url);
		}) as never)
	];
});

afterEach(() => {
	cleanup();
	spies.forEach((s) => s.mockRestore());
});

async function mountCard() {
	const r = render(BackupCard, { props: {} });
	await flush(); // backupStatus() を待つ（これが返るまでカードは出ない）
	return r;
}

const pressExport = async () => {
	await fireEvent.click(screen.getByRole('button', { name: 'バックアップする' }));
	await flush();
};

describe('バックアップのカード', () => {
	it('書き出しただけでは「ほぞんしました」と言わない', async () => {
		await mountCard();
		await pressExport();

		expect(marked, '確かめる前に催促の基準を進めている').toEqual([]);
		expect(screen.queryByText(/をほぞんしました。/), '渡しただけで「ほぞんしました」と出ている')
			.toBeNull();
		// かわりに、確かめる問いかけが出ている
		expect(screen.getByText('ファイルは ほぞんできましたか？')).toBeTruthy();
	});

	it('「ほぞんできた」を押したときだけ、催促の基準を進める', async () => {
		await mountCard();
		await pressExport();
		await fireEvent.click(screen.getByRole('button', { name: 'ほぞんできた' }));
		await flush();

		expect(marked, '書き出したときの控えをそのまま渡していない').toEqual([
			{ seq: 7, exported_at: 1_785_900_000, storage_id: 'gen-1' }
		]);
		expect(screen.getByText(/natsuyasumi-board-2026-08-09\.json をほぞんしました。/)).toBeTruthy();
		expect(screen.queryByText('ファイルは ほぞんできましたか？'), '問いかけが残っている').toBeNull();
	});

	// 出てこなかったと答えた親のところでは、催促がそのまま残らなければ意味がない。
	it('「できていない」を押したら、何も記録しない', async () => {
		await mountCard();
		await pressExport();
		await fireEvent.click(screen.getByRole('button', { name: 'できていない' }));
		await flush();

		expect(marked, '「できていない」なのに基準を進めている').toEqual([]);
		expect(dismissed, '答えたファイルの控えを渡して落としていない').toEqual([
			{ seq: 7, exported_at: 1_785_900_000, storage_id: 'gen-1' }
		]);
		expect(screen.getByText(/日づけは そのままにしました/)).toBeTruthy();
		expect(screen.queryByText('ファイルは ほぞんできましたか？')).toBeNull();
	});

	// 待っているあいだに復元した／別のタブがもっと新しいものを書き出した場合。
	// 保存側が断る（recorded:false）ので、画面はそれを成功と言ってはいけない。
	it('進められなかったときは「ほぞんしました」と言わない', async () => {
		await mountCard();
		markRecorded = false;
		await pressExport();
		await fireEvent.click(screen.getByRole('button', { name: 'ほぞんできた' }));
		await flush();

		expect(marked).toEqual([{ seq: 7, exported_at: 1_785_900_000, storage_id: 'gen-1' }]);
		expect(screen.queryByText(/をほぞんしました。/), '断られたのに成功と言っている').toBeNull();
		expect(screen.getByText(/日づけは変えませんでした/)).toBeTruthy();
	});

	// 出てこなかったときの逃げ道。こちらが仕込んだクリックと違って、親が押したものは
	// ブラウザに落とされない。
	it('押し直せるリンクを、ファイル名つきで出す', async () => {
		await mountCard();
		await pressExport();

		const link = screen.getByRole('link', { name: 'こちらからほぞん' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('blob:test-1');
		expect(link.getAttribute('download')).toBe('natsuyasumi-board-2026-08-09.json');
	});

	it('もう一度書き出したら、前の問いかけは1つだけに置きかわる', async () => {
		await mountCard();
		await pressExport();
		exportSeq = 9;
		exportedAt = 1_785_900_500;
		await pressExport();

		expect(screen.getAllByText('ファイルは ほぞんできましたか？')).toHaveLength(1);
		expect(revoked, '前のぶんを解放していない').toEqual([created[0]]);
		await fireEvent.click(screen.getByRole('button', { name: 'ほぞんできた' }));
		await flush();
		expect(marked, '古いほうの書き出しで記録している').toEqual([
			{ seq: 9, exported_at: 1_785_900_500, storage_id: 'gen-1' }
		]);
	});

	// まるごと復元の口は、このカードの「もどす」だけではない（管理画面トップの
	// 「JSON をインポート」からも置きかわる）。あちらから置きかえたときに問いかけが
	// 残ると、そのファイルには入っていない中身まで「ほぞんできた」と答えられてしまう。
	// 問いかけを落とすのは置きかえ側（replaceAll）で、カードは読み直して追随する。
	it('外から復元されたら、抱えている写しを手放して問いかけも消える', async () => {
		const r = await mountCard();
		await pressExport();
		expect(screen.getByText('ファイルは ほぞんできましたか？')).toBeTruthy();

		// 置きかえる前（写しを手放す）
		(r.component as unknown as { resetForRestore(): void }).resetForRestore();
		await flush();
		expect(revoked, '抱えていた写しを解放していない').toEqual([created[0]]);

		// 置きかえたあと（保存側が問いかけを落としてある）
		status = { ...status, pending_backup: null };
		await (r.component as unknown as { reloadStatus(): Promise<void> }).reloadStatus();
		await flush();

		expect(screen.queryByText('ファイルは ほぞんできましたか？'), '問いかけが残っている').toBeNull();
		expect(marked, '落としただけで記録している').toEqual([]);
	});

	// 今回の回帰の本体。iPhone で共有シートやプレビューから「もどる」と、この画面は
	// 作り直される。問いかけがカードの中にしか無かったころは、そこで聞く口ごと消えて、
	// ファイルは端末にあるのに「まだバックアップしていません」が二度と引っ込まなかった。
	it('開き直したあとでも、聞きそびれた問いかけは出ている', async () => {
		status = {
			...status,
			pending_backup: {
				ticket: { seq: 7, exported_at: 1_785_900_000, storage_id: 'gen-1' },
				filename: 'natsuyasumi-board-2026-08-09.json'
			}
		};
		await mountCard(); // 書き出しは押さない（前に開いていたときの続き）

		expect(screen.getByText('ファイルは ほぞんできましたか？')).toBeTruthy();
		expect(screen.getByText(/natsuyasumi-board-2026-08-09\.json を書き出しました/)).toBeTruthy();
		expect(created, '開き直しただけで写しを作っている').toEqual([]);
		// blob はもう無いので、押し直せるリンクは出せない（出すと href が空のリンクになる）
		expect(screen.queryByRole('link', { name: 'こちらからほぞん' })).toBeNull();
		expect(screen.getByRole('button', { name: 'もういちど書き出す' })).toBeTruthy();
	});

	it('開き直したあとの「ほぞんできた」は、保存に残っている控えを渡す', async () => {
		status = {
			...status,
			pending_backup: {
				ticket: { seq: 4, exported_at: 1_785_800_000, storage_id: 'gen-0' },
				filename: 'natsuyasumi-board-2026-08-08.json'
			}
		};
		await mountCard();
		await fireEvent.click(screen.getByRole('button', { name: 'ほぞんできた' }));
		await flush();

		expect(marked, '保存に残っていた控えではないものを渡している').toEqual([
			{ seq: 4, exported_at: 1_785_800_000, storage_id: 'gen-0' }
		]);
		expect(
			screen.getByText(/natsuyasumi-board-2026-08-08\.json をほぞんしました。/),
			'ファイル名を保存側から取れていない'
		).toBeTruthy();
	});

	// 別のタブが後から書き出していたら、端末にはファイルが2つある。古いほうに答えたときに
	// 新しいほうの控えを渡すと、そのファイルの問いかけが消える＝確かめる口が無くなる。
	it('答えるときは、画面に出ている問いかけの控えを渡す', async () => {
		const r = await mountCard();
		await pressExport();

		// 別のタブが後から書き出した（保存の控えが置きかわった）状況を読み込む
		const newer = {
			ticket: { seq: 9, exported_at: 1_785_900_500, storage_id: 'gen-1' },
			filename: 'natsuyasumi-board-2026-08-10.json'
		};
		status = { ...status, pending_backup: newer };
		await (r.component as unknown as { reloadStatus(): Promise<void> }).reloadStatus();
		await flush();

		await fireEvent.click(screen.getByRole('button', { name: 'できていない' }));
		await flush();

		expect(dismissed, '画面に出ているのと違うファイルについて答えている').toEqual([newer.ticket]);
	});

	// 押し直せるリンクが指すのは、いま手元にある blob。問いかけが別のファイルの話に
	// なっていたら（別のタブが後から書き出した）、文中の名前とリンクの中身が食い違う。
	it('押し直せるリンクは、問いかけと同じファイルのときだけ出す', async () => {
		const r = await mountCard();
		await pressExport();
		expect(screen.getByRole('link', { name: 'こちらからほぞん' })).toBeTruthy();

		status = {
			...status,
			pending_backup: {
				ticket: { seq: 9, exported_at: 1_785_900_500, storage_id: 'gen-1' },
				filename: 'natsuyasumi-board-2026-08-10.json'
			}
		};
		await (r.component as unknown as { reloadStatus(): Promise<void> }).reloadStatus();
		await flush();

		expect(
			screen.queryByRole('link', { name: 'こちらからほぞん' }),
			'別のファイルの問いかけに、手元の写しへのリンクを出している'
		).toBeNull();
		expect(screen.getByText(/natsuyasumi-board-2026-08-10\.json を書き出しました/)).toBeTruthy();
	});

	// blob URL が抱えているのは記録まるごとの写し。解放できる者が誰も居ない状態で作ると、
	// タブを閉じるまで残る。往復の途中で画面を離れるのは、いちばん起きやすい経路
	// （管理画面の「子どもページへ」はカードのすぐ上にある）。
	it('往復の途中で画面を離れたら、渡す先も無いので作らない', async () => {
		const r = await mountCard();
		holdExport = true;
		await fireEvent.click(screen.getByRole('button', { name: 'バックアップする' }));
		await flush();

		r.unmount(); // 応答が返る前に離れる
		releaseExport?.();
		await flush();

		expect(created, '聞く相手が居ないのに書き出しを作っている').toEqual([]);
		expect(created.length - revoked.length, '解放されない blob URL が残っている').toBe(0);
		// ファイルは1つも生まれていない。ここで問いかけを覚えると、次に開いた親が
		// 覚えのある名前を見て「ほぞんできた」と答えられる＝手元に無いファイルで
		// 催促が1週間消える。だから「渡せた」と分かってからしか覚えない。
		expect(noted, 'ファイルが無いのに問いかけを残している').toEqual([]);
	});
});

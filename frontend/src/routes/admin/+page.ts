import type { AdminSession, ChildInfo } from '$lib/api';
import type { PageLoad } from './$types';

// 一覧ページ: セッション状態 → 認証済みなら定義一覧。
// SSR でも本文を出すため load で取り切る（PIN クッキーは hooks の /api プロキシで中継される）。
export const load: PageLoad = async ({ fetch }) => {
	let session: AdminSession | null = null;
	try {
		const r = await fetch('/api/admin/session');
		if (r.ok) session = (await r.json()) as AdminSession;
	} catch {
		session = null; // バックエンド不達はページ側でエラー表示
	}

	let definitions: ChildInfo[] = [];
	let loadError: string | null = null;
	if (session && !session.admin_disabled && (!session.pin_required || session.authenticated)) {
		try {
			const r = await fetch('/api/admin/definitions');
			if (r.ok) definitions = ((await r.json()) as { definitions: ChildInfo[] }).definitions ?? [];
			else loadError = `一覧をよみこめませんでした（${r.status}）`;
		} catch {
			loadError = 'サーバーにつながりませんでした';
		}
	}
	return { session, definitions, loadError };
};

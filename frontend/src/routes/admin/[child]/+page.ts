import type { AdminDefinitionEntry, AdminSession } from '$lib/api';
import type { PageLoad } from './$types';

// セクションエディタ: セッション状態 → 認証済みなら編集用ドキュメントを取り切る。
// SSR でも本文を出すため、ページ側はこの entry から直接ドラフトを初期化する
// （$effect は SSR で走らない）。
export const load: PageLoad = async ({ fetch, params, url }) => {
	// ?year= が付いていればその年を編集する（省略時はサーバが今の年を選ぶ）
	const yearParam = url.searchParams.get('year');
	const year = yearParam && /^\d{4}$/.test(yearParam) ? `?year=${yearParam}` : '';
	let session: AdminSession | null = null;
	try {
		const r = await fetch('/api/admin/session');
		if (r.ok) session = (await r.json()) as AdminSession;
	} catch {
		session = null;
	}

	let entry: AdminDefinitionEntry | null = null;
	let loadError: string | null = null;
	if (session && !session.admin_disabled && (!session.pin_required || session.authenticated)) {
		try {
			const r = await fetch(`/api/admin/definitions/${encodeURIComponent(params.child)}${year}`);
			if (r.ok) entry = (await r.json()) as AdminDefinitionEntry;
			else if (r.status === 404) loadError = `「${params.child}」の定義がみつかりませんでした`;
			else loadError = `よみこみに失敗しました（${r.status}）`;
		} catch {
			loadError = 'サーバーにつながりませんでした';
		}
	}
	return { session, entry, loadError, child: params.child };
};

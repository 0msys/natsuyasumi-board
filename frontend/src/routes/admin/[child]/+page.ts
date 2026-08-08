import { api, type AdminDefinitionEntry, type AdminSession } from '$lib/api';
import { errorStatus } from '$lib/api/apiError';
import type { PageLoad } from './$types';

// 子ども名は列挙できないので、この1ルートだけ静的に書き出せない。
// lite（GitHub Pages）では 404.html フォールバックから起動する。
export const prerender = false;

// セクションエディタ: セッション状態 → 認証済みなら編集用ドキュメントを取り切る。
export const load: PageLoad = async ({ params, url }) => {
	// ?year= が付いていればその年を編集する（省略時は「いま出ている年」が選ばれる）
	const yearParam = url.searchParams.get('year');
	const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;

	let session: AdminSession | null = null;
	try {
		session = await api.adminSession();
	} catch {
		session = null;
	}

	let entry: AdminDefinitionEntry | null = null;
	let loadError: string | null = null;
	if (session && !session.admin_disabled && (!session.pin_required || session.authenticated)) {
		try {
			entry = await api.adminGetDefinition(params.child, year);
		} catch (e) {
			const status = errorStatus(e);
			if (status === 404) loadError = `「${params.child}」の定義がみつかりませんでした`;
			else if (status) loadError = `よみこみに失敗しました（${status}）`;
			else loadError = 'サーバーにつながりませんでした';
		}
	}
	return { session, entry, loadError, child: params.child };
};

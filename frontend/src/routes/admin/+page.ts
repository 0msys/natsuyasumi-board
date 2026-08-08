import { api, type AdminSession, type ChildInfo } from '$lib/api';
import { errorStatus } from '$lib/api/apiError';
import type { PageLoad } from './$types';

// 一覧ページ: セッション状態 → 認証済みなら定義一覧。
export const load: PageLoad = async () => {
	let session: AdminSession | null = null;
	try {
		session = await api.adminSession();
	} catch {
		session = null; // 取得できないのはページ側でエラー表示
	}

	let definitions: ChildInfo[] = [];
	let loadError: string | null = null;
	if (session && !session.admin_disabled && (!session.pin_required || session.authenticated)) {
		try {
			definitions = (await api.adminListDefinitions()).definitions ?? [];
		} catch (e) {
			const status = errorStatus(e);
			loadError = status
				? `一覧をよみこめませんでした（${status}）`
				: 'サーバーにつながりませんでした';
		}
	}
	return { session, definitions, loadError };
};

import { api, type AdminSession } from '$lib/api';
import type { PageLoad } from './$types';

// 初回ウィザード: PIN ゲートの判定にセッション状態だけ読む。
export const load: PageLoad = async () => {
	let session: AdminSession | null = null;
	try {
		session = await api.adminSession();
	} catch {
		session = null;
	}
	return { session };
};

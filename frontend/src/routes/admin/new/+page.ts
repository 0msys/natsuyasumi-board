import type { AdminSession } from '$lib/api';
import type { PageLoad } from './$types';

// 初回ウィザード: PIN ゲートの判定にセッション状態だけ読む。
export const load: PageLoad = async ({ fetch }) => {
	let session: AdminSession | null = null;
	try {
		const r = await fetch('/api/admin/session');
		if (r.ok) session = (await r.json()) as AdminSession;
	} catch {
		session = null;
	}
	return { session };
};

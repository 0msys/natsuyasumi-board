import { redirect } from '@sveltejs/kit';
import type { ChildInfo, SummerState } from '$lib/api';
import type { PageLoad } from './$types';

// 子ども選択 → state 取得。定義がゼロなら初回ウィザードへ誘導する。
export const load: PageLoad = async ({ fetch, url }) => {
	let children: ChildInfo[] = [];
	try {
		const r = await fetch('/api/summer/children');
		if (r.ok) children = ((await r.json()) as { children: ChildInfo[] }).children ?? [];
	} catch {
		// バックエンド不達はページ側の「よみこめなかった」表示に任せる
	}
	if (children.length === 0) redirect(307, '/admin/new');

	const valid = children.filter((c) => c.valid);
	const requested = url.searchParams.get('child');
	const chosen = valid.find((c) => c.child === requested) ?? valid[0];
	if (!chosen) redirect(307, '/admin'); // 定義はあるが全部壊れている → 管理画面で直してもらう

	let summer: SummerState | null = null;
	try {
		const r = await fetch(`/api/summer/state?child=${encodeURIComponent(chosen.child)}`);
		if (r.ok) summer = (await r.json()) as SummerState;
	} catch {
		summer = null;
	}
	return { children: valid, child: chosen.child, summer };
};

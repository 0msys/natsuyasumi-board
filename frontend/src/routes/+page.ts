import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { api, type ChildInfo, type SummerState } from '$lib/api';
import type { PageLoad } from './$types';

// 子ども選択 → state 取得。定義がゼロなら初回ウィザードへ誘導する。
export const load: PageLoad = async ({ url }) => {
	let children: ChildInfo[] = [];
	try {
		children = (await api.summerChildren()).children ?? [];
	} catch {
		// 取得できないときはページ側の「よみこめなかった」表示に任せる
	}
	if (children.length === 0) redirect(307, resolve('/admin/new'));

	const valid = children.filter((c) => c.valid);
	const requested = url.searchParams.get('child');
	const chosen = valid.find((c) => c.child === requested) ?? valid[0];
	if (!chosen) redirect(307, resolve('/admin')); // 定義はあるが全部壊れている → 管理画面で直してもらう

	let summer: SummerState | null = null;
	try {
		summer = await api.summerState(chosen.child);
	} catch {
		summer = null;
	}
	return { children: valid, child: chosen.child, summer };
};

// 新学期じゅんびの「つぎにやること」を1件だけ選ぶ（見出し下のヒント用・純関数）。
// まだ できていない項目のうち、期日（due）がいちばん近いものを返す。全部できていれば null。
// due は "YYYY-MM-DD" 固定なので文字列比較で日付順になる。
// 同じ期日が並んだときは定義の並び順（＝管理画面で親が並べた順）の先頭を優先する。
// 期日を過ぎた未了項目はいちばん前に出る＝「まだ残っているよ」を隠さない。
import type { SummerSchoolStartItem } from '$lib/api';

export function nextSchoolStartItem(items: SummerSchoolStartItem[]): SummerSchoolStartItem | null {
	let next: SummerSchoolStartItem | null = null;
	for (const item of items) {
		if (item.done) continue;
		if (next === null || item.due < next.due) next = item; // 同着は先に見つけた方を残す
	}
	return next;
}

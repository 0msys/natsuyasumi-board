// ごほうびグラフの縦軸の上端を決める（純関数）。
//
// ふだんは max_total（＝1日の上限 × 期間日数）。ただし「1日の上限を超える平均点」は
// 検証が警告を出すだけで保存できる（ごほうびを据え置いたままチャレンジを減らす、など）。
// そのとき threshold > max_total になり、上端を伸ばさないと y(threshold) がプロット領域の
// 上へ出て、ランク帯の高さが0になり・しきい値ラベルが viewBox の外へ消え・ペースの点線が
// 突き抜けて切れる（issue #28）。健全な定義では max_total がそのまま返る＝描画は変わらない。
import type { SummerRewards } from '$lib/api';

export function chartTopValue(rewards: Pick<SummerRewards, 'max_total' | 'ranks'>): number {
	// max_total が 0 や欠落でも 0 除算にしない（|| 1 は元の実装から引き継ぐ）
	return Math.max(rewards.max_total || 1, ...rewards.ranks.map((r) => r.threshold));
}

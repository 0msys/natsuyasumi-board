// 「今日」と「いま」。
//
// docker 版では、これはサーバが決めていた（backend/app/core.py の JST と
// service.today_jst()）。lite 版にはサーバが無いので端末の時計から導く。
// ただしタイムゾーンは端末の設定ではなく JST に固定する——帰省先や旅行先で端末の
// タイムゾーンが変わっても、夏休みの「その日」は日本の日付だから。
//
// 依存するのは端末の時計そのものだけ。なお backend 版でも書き込みは
// summerSetCheck(child, day, ...) と、クライアントが day を送る形だったので、
// ここで変わるのは「その day を誰が決めるか」の一段だけ。
import type { DayString } from './dates';

// en-US を使って formatToParts で組み立てる。en-CA の format() が 'YYYY-MM-DD' を
// 返すのは事実上そうなだけで仕様の保証ではないので、部品から自分で組む。
const JST = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Asia/Tokyo',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** JST での今日（'YYYY-MM-DD'）。 */
export function todayJst(now: Date = new Date()): DayString {
	const parts: Record<string, string> = {};
	for (const part of JST.formatToParts(now)) parts[part.type] = part.value;
	return `${parts.year}-${parts.month}-${parts.day}`;
}

/** いまのエポック秒。タイマーの server_now 相当。 */
export const nowEpochSec = (): number => Math.floor(Date.now() / 1000);

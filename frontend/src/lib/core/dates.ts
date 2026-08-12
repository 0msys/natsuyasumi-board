// 日付は 'YYYY-MM-DD' の文字列で持ち、計算のときだけ UTC の Date を経由する。
//
// ローカルタイムゾーンの Date を使うと、端末の設定しだいで前後の日にずれる。
// この画面の日付は「JST のその日」であって時刻を持たないので、UTC で数えるのが素直
// （$lib/summer/dateLabel.ts が表示側で文字列のまま切り出しているのと同じ考えかた）。

/** 'YYYY-MM-DD'。型としては別名だが、実体はただの文字列。 */
export type DayString = string;

const DAY_MS = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' を UTC のエポックミリ秒にする。形が違えば null。 */
export function parseDay(day: string): number | null {
	const m = PATTERN.exec(day);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = Date.UTC(y, mo - 1, d);
	const back = new Date(t);
	// 2026-02-30 のような「桁は合っているが存在しない日」を弾く（Date.UTC は繰り上げてしまう）
	if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
		return null;
	}
	return t;
}

/** 'YYYY-MM-DD' として妥当か。 */
export const isDay = (day: string): boolean => parseDay(day) !== null;

/** UTC のエポックミリ秒を 'YYYY-MM-DD' にする。 */
export function formatDay(t: number): DayString {
	const d = new Date(t);
	const p = (n: number, w = 2) => String(n).padStart(w, '0');
	return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 妥当な日付として読む。読めなければ投げる（呼ぶ側が先に検証している前提の内部用）。 */
export function mustParseDay(day: string): number {
	const t = parseDay(day);
	if (t === null) throw new Error(`日付として読めない: ${day}`);
	return t;
}

/** n 日ずらす（負も可）。 */
export const addDays = (day: DayString, n: number): DayString =>
	formatDay(mustParseDay(day) + n * DAY_MS);

/** b - a の日数（同日なら 0）。 */
export const diffDays = (a: DayString, b: DayString): number =>
	Math.round((mustParseDay(b) - mustParseDay(a)) / DAY_MS);

/** from から to まで（両端を含む）の日を並べる。to < from なら空。 */
export function eachDay(from: DayString, to: DayString): DayString[] {
	const days: DayString[] = [];
	const last = mustParseDay(to);
	for (let t = mustParseDay(from); t <= last; t += DAY_MS) days.push(formatDay(t));
	return days;
}

// 'YYYY-MM-DD' は桁が揃っているので、文字列の大小比較がそのまま日付の前後になる。
export const isBefore = (a: DayString, b: DayString): boolean => a < b;
export const isAfter = (a: DayString, b: DayString): boolean => a > b;
/** lo <= day <= hi。 */
export const isBetween = (day: DayString, lo: DayString, hi: DayString): boolean =>
	lo <= day && day <= hi;

/** 月（1-12）。 */
export const monthOf = (day: DayString): number => Number(day.slice(5, 7));
/** 日（1-31）。 */
export const dayOfMonth = (day: DayString): number => Number(day.slice(8, 10));
/** 年。 */
export const yearOf = (day: DayString): number => Number(day.slice(0, 4));

/** 年を n だけずらす。2/29 は存在しない年では 2/28 に丸める。
 *
 *  読めない値は投げる（addDays / diffDays と同じ）。形を確かめずに年・月・日を切り出して
 *  いたころは shiftYear('', 1) が '0001-00--1'、shiftYear('abc', 1) が '0NaN-00--1' という
 *  「日付に見えるゴミ」を返し、そのまま来年ぶんの定義に書き込まれていた。下の丸めは
 *  「うるう日だけがここに来る」前提なので、入口で守らないとその前提が成り立たない。 */
export function shiftYear(day: DayString, n: number): DayString {
	mustParseDay(day);
	const y = yearOf(day) + n;
	const mo = monthOf(day);
	const d = dayOfMonth(day);
	const p = (v: number, w = 2) => String(v).padStart(w, '0');
	const candidate = `${p(y, 4)}-${p(mo)}-${p(d)}`;
	if (isDay(candidate)) return candidate;
	// うるう日だけがここに来る（2/29 → 2/28）
	return `${p(y, 4)}-${p(mo)}-${p(d - 1)}`;
}

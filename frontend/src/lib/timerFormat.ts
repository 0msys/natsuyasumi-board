// タイマー・アラームの表示整形（カード=HomePlayerCards と 大きいポップアップ=TimerOverlay で共有）。
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 相対タイマーの残り時間（M:SS / H:MM:SS）。nowMs は毎秒更新される現在時刻（親の now 由来）。 */
export function fmtRemaining(fireAt: number, nowMs: number): string {
	const s = Math.max(0, Math.round((fireAt * 1000 - nowMs) / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** 経過時間（ストップウォッチ・アウトメディア視聴タイマー）を M:SS / H:MM:SS で整形。 */
export function fmtElapsed(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** 絶対アラームの時刻（H:MM）。 */
export function fmtClock(fireAt: number): string {
	const d = new Date(fireAt * 1000);
	return `${d.getHours()}:${pad2(d.getMinutes())}`;
}

/** ラベルの既定表示（無ければ種別名）。 */
export function timerLabel(label: string | null, kind: string): string {
	return label ?? (kind === 'alarm' ? 'アラーム' : 'タイマー');
}

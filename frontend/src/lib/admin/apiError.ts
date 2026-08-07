// api が投げた失敗の解釈。
//
// いまは両実装とも ApiError（status / detail を構造で持つ）を投げるので、まずはそれを見る。
// 正規表現の経路は、api を経由しない場所で投げられた素の Error のための保険として残す。
import { ApiError } from '$lib/api/contract';

/** HTTP ステータスを取り出す（判別できなければ null）. */
export function errorStatus(e: unknown): number | null {
	if (e instanceof ApiError) return e.status;
	const raw = e instanceof Error ? e.message : String(e);
	const m = raw.match(/ → (\d{3})( |$)/);
	return m ? Number(m[1]) : null;
}

/** エラー本文（`{"detail": "..."}`）から人向けの detail を取り出す（無ければ原文）. */
export function errorDetail(e: unknown): string {
	const raw = e instanceof ApiError ? e.detail : e instanceof Error ? e.message : String(e);
	const m = raw.match(/\{.*\}$/s);
	if (m) {
		try {
			const detail = (JSON.parse(m[0]) as { detail?: unknown }).detail;
			if (typeof detail === 'string' && detail) return detail;
		} catch {
			// JSON でなければ原文をそのまま返す
		}
	}
	return raw;
}

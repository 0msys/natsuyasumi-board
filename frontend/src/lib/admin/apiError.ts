// API クライアント（$lib/api/client.ts）が投げる Error（`path → status detail` 形式）の解釈。

/** エラーメッセージから HTTP ステータスを取り出す（判別できなければ null）. */
export function errorStatus(e: unknown): number | null {
	const raw = e instanceof Error ? e.message : String(e);
	const m = raw.match(/ → (\d{3})( |$)/);
	return m ? Number(m[1]) : null;
}

/** エラー本文（`{"detail": "..."}`）から人向けの detail を取り出す（無ければ原文）. */
export function errorDetail(e: unknown): string {
	const raw = e instanceof Error ? e.message : String(e);
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

// fetch クライアント。全 API 呼び出しの単一窓口（$lib/api の api 名前空間）。
import type {
	AdminDefinitionEntry,
	AdminDocument,
	AdminSession,
	ChildInfo,
	KanjiGrades,
	SummerCheckStatus,
	SummerDecision,
	SummerMediaTimerState,
	SummerMeta,
	SummerState,
	SummerTodoSpeech,
	TtsSpeakers,
	TtsStatus,
	ValidationResult
} from './types';

// same-origin はブラウザ既定だが、管理画面の PIN クッキーの前提なので明示する。
async function get<T>(path: string): Promise<T> {
	const res = await fetch(path, { credentials: 'same-origin' });
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`${path} → ${res.status} ${detail}`);
	}
	return res.json();
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
	const res = await fetch(path, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		credentials: 'same-origin'
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`${path} → ${res.status} ${detail}`);
	}
	return res.json();
}

const post = <T>(path: string, body: unknown) => send<T>('POST', path, body);

const q = (child: string) => `child=${encodeURIComponent(child)}`;

// 管理 API の ?year=。省略時はサーバが「いま子どもページに出ている年」を選ぶ。
const yearQuery = (year?: number) => (year == null ? '' : `?year=${year}`);

export const api = {
	// ── 子どもページ（チェックはサーバ権威＝複数端末で共有） ──
	summerChildren: () => get<{ children: ChildInfo[] }>('/api/summer/children'),
	summerState: (child: string) => get<SummerState>(`/api/summer/state?${q(child)}`),
	summerSetCheck: (child: string, day: string, itemKey: string, status: SummerCheckStatus) =>
		post<{ status: SummerCheckStatus }>('/api/summer/check/set', {
			child,
			day,
			item_key: itemKey,
			status
		}),
	summerSetMeta: (
		child: string,
		day: string,
		itemKey: string,
		meta: Record<string, string | number | null>
	) => post<{ meta: SummerMeta }>('/api/summer/check/meta', { child, day, item_key: itemKey, meta }),
	summerToggleFlag: (child: string, itemKey: string) =>
		post<{ value: number; done: boolean }>('/api/summer/flag/toggle', { child, item_key: itemKey }),
	summerSetCount: (child: string, itemKey: string, value: number) =>
		post<{ value: number; done: boolean }>('/api/summer/count/set', {
			child,
			item_key: itemKey,
			value
		}),
	summerSetDecision: (child: string, itemKey: string, decision: SummerDecision) =>
		post<{ decision: SummerDecision }>('/api/summer/decision/set', {
			child,
			item_key: itemKey,
			decision
		}),
	summerTodoSpeech: (child: string) => get<SummerTodoSpeech>(`/api/summer/todo-speech?${q(child)}`),
	// アウトメディア視聴タイマー（サーバ権威・複数端末で共有）
	summerMediaTimerState: (child: string) =>
		get<SummerMediaTimerState>(`/api/summer/media-timer/state?${q(child)}`),
	summerMediaTimerStart: (child: string) =>
		post<SummerMediaTimerState>('/api/summer/media-timer/start', { child }),
	summerMediaTimerPause: (child: string) =>
		post<SummerMediaTimerState>('/api/summer/media-timer/pause', { child }),

	// ── TTS（VOICEVOX オプション。available=false なら音声ボタンを出さない） ──
	ttsStatus: (child?: string) =>
		get<TtsStatus>(child ? `/api/tts/status?${q(child)}` : '/api/tts/status'),
	// キャラクター一覧（管理画面の「こえ」えらび。VOICEVOX 不在なら available=false）
	ttsSpeakers: () => get<TtsSpeakers>('/api/tts/speakers'),
	// 話者は child（その子の設定）で決まる。speaker は管理画面の試聴用の直接指定（child より優先）
	ttsBlob: async (
		text: string,
		opts: { child?: string; speaker?: number } = {}
	): Promise<Blob> => {
		const res = await fetch('/api/tts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ text, ...opts })
		});
		// 本文（detail）まで載せる。get/send と揃えないと、呼び出し側は「400 なのか 503 なのか」
		// までしか分からず、「この声では鳴らせない」と「VOICEVOX が居ない」を書き分けられない。
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			throw new Error(`/api/tts → ${res.status} ${detail}`);
		}
		return res.blob();
	},

	// ── 管理画面 ──
	adminSession: () => get<AdminSession>('/api/admin/session'),
	adminLogin: (pin: string) => post<{ ok: boolean }>('/api/admin/login', { pin }),
	adminListDefinitions: () => get<{ definitions: ChildInfo[] }>('/api/admin/definitions'),
	adminCreateDefinition: (body: {
		child: string;
		child_kana: string;
		grade: string;
		year: number;
		period: { start: string; end: string; first_day_of_school: string };
		template: 'standard' | 'empty';
	}) => post<AdminDefinitionEntry>('/api/admin/definitions', body),
	// year は編集中の年。省略するとサーバが「いま子どもページに出ている年」を選ぶ。
	adminGetDefinition: (child: string, year?: number) =>
		get<AdminDefinitionEntry>(
			`/api/admin/definitions/${encodeURIComponent(child)}${yearQuery(year)}`
		),
	adminSaveDefinition: (child: string, doc: AdminDocument, revision: number, year?: number) =>
		send<AdminDefinitionEntry>(
			'PUT',
			`/api/admin/definitions/${encodeURIComponent(child)}${yearQuery(year)}`,
			{ doc, revision }
		),
	adminCreateNextYear: (child: string) =>
		post<AdminDefinitionEntry>(
			`/api/admin/definitions/${encodeURIComponent(child)}/next-year`,
			{}
		),
	adminValidateDefinition: (child: string, doc: AdminDocument) =>
		post<ValidationResult>(`/api/admin/definitions/${encodeURIComponent(child)}/validate`, { doc }),
	adminRenameChild: (child: string, next: string) =>
		post<{ ok: boolean; child: string }>(`/api/admin/definitions/${encodeURIComponent(child)}/rename`, {
			new: next
		}),
	// year 指定でその年だけ、省略でその子の全年を消す。
	adminDeleteDefinition: (child: string, year?: number) =>
		send<{ ok: boolean }>(
			'DELETE',
			`/api/admin/definitions/${encodeURIComponent(child)}${yearQuery(year)}`,
			{}
		),
	adminUsage: (child: string) =>
		get<{ usage: Record<string, number> }>(
			`/api/admin/definitions/${encodeURIComponent(child)}/usage`
		),
	adminImportDefinition: (doc: AdminDocument) =>
		post<AdminDefinitionEntry>('/api/admin/definitions/import', { doc }),
	adminKanji: () => get<KanjiGrades>('/api/admin/kanji')
};

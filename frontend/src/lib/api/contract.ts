// api の契約（実装が2つあるので、その両方が満たすべき形をここに1本だけ置く）。
//
//   client.ts        … docker 版。/api を fetch する（FastAPI が計算する）。
//   local/index.ts   … lite 版。src/lib/core で計算し src/lib/store に保存する。
//
// どちらも `export const api: Api` と注釈する。片方だけメソッドを足したり引数をずらしたり
// すると `bun run check` / `check:lite` が落ちる——二重実装で最初に壊れるのは
// 「片方だけ直した」なので、そこは型で止める。
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

/** api が失敗を伝えるときの例外。
 *
 *  status を持たせているのは、呼ぶ側が「404 なのか 409 なのか」で分岐するため。
 *  かつては `path → status detail` という文字列を組み立てて呼び出し側が正規表現で
 *  読み戻していた（src/lib/api/apiError.ts）が、それだと lite 実装まで同じ文字列を
 *  作らされる。status と detail は最初から構造で持つ。 */
export class ApiError extends Error {
	readonly status: number;
	/** サーバの `{"detail": "..."}` や、lite 側の子ども向け文言。 */
	readonly detail: string;

	constructor(status: number, detail: string, where = '') {
		super(where ? `${where} → ${status} ${detail}` : `${status} ${detail}`);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
	}
}

export type Api = {
	// ── 子どもページ ──
	summerChildren(): Promise<{ children: ChildInfo[] }>;
	summerState(child: string): Promise<SummerState>;
	summerSetCheck(
		child: string,
		day: string,
		itemKey: string,
		status: SummerCheckStatus
	): Promise<{ status: SummerCheckStatus }>;
	summerSetMeta(
		child: string,
		day: string,
		itemKey: string,
		meta: Record<string, string | number | null>
	): Promise<{ meta: SummerMeta }>;
	summerToggleFlag(child: string, itemKey: string): Promise<{ value: number; done: boolean }>;
	summerSetCount(
		child: string,
		itemKey: string,
		value: number
	): Promise<{ value: number; done: boolean }>;
	summerSetDecision(
		child: string,
		itemKey: string,
		decision: SummerDecision
	): Promise<{ decision: SummerDecision }>;
	summerTodoSpeech(child: string): Promise<SummerTodoSpeech>;

	// アウトメディア視聴タイマー
	summerMediaTimerState(child: string): Promise<SummerMediaTimerState>;
	summerMediaTimerStart(child: string): Promise<SummerMediaTimerState>;
	summerMediaTimerPause(child: string): Promise<SummerMediaTimerState>;

	// ── 読み上げ（lite では available:false / supported:false で丸ごと畳む） ──
	ttsStatus(child?: string): Promise<TtsStatus>;
	ttsSpeakers(): Promise<TtsSpeakers>;
	ttsBlob(text: string, opts?: { child?: string; speaker?: number }): Promise<Blob>;

	// ── 管理画面 ──
	adminSession(): Promise<AdminSession>;
	adminLogin(pin: string): Promise<{ ok: boolean }>;
	adminListDefinitions(): Promise<{ definitions: ChildInfo[] }>;
	adminCreateDefinition(body: {
		child: string;
		child_kana: string;
		grade: string;
		year: number;
		period: { start: string; end: string; first_day_of_school: string };
		template: 'standard' | 'empty';
	}): Promise<AdminDefinitionEntry>;
	adminGetDefinition(child: string, year?: number): Promise<AdminDefinitionEntry>;
	adminSaveDefinition(
		child: string,
		doc: AdminDocument,
		revision: number,
		year?: number
	): Promise<AdminDefinitionEntry>;
	adminCreateNextYear(child: string): Promise<AdminDefinitionEntry>;
	adminValidateDefinition(child: string, doc: AdminDocument): Promise<ValidationResult>;
	adminRenameChild(child: string, next: string): Promise<{ ok: boolean; child: string }>;
	adminDeleteDefinition(child: string, year?: number): Promise<{ ok: boolean }>;
	adminUsage(child: string): Promise<{ usage: Record<string, number> }>;
	adminImportDefinition(doc: AdminDocument): Promise<AdminDefinitionEntry>;
	adminKanji(): Promise<KanjiGrades>;

	/** エクスポート用に、保存するファイル名と中身を返す。
	 *
	 *  ダウンロードそのもの（Blob の組み立て）は $lib/admin/download.ts が行う。
	 *  かつては <a href="/api/.../export" download> でブラウザに直接取りにいかせていたが、
	 *  それだと api を通らない経路が1本だけ残り、lite では存在しない URL になる。 */
	adminExportDoc(child: string, year?: number): Promise<{ filename: string; doc: AdminDocument }>;

	// ── まるごとバックアップ（lite だけ。docker 版はデータがサーバにあるので supported:false） ──
	//
	// lite はブラウザの中にしか記録が無い。iOS Safari は「7日間ひらかなかったサイト」の
	// 保存データを消すことがあるので、消えたときに戻せる道と、催促する材料が要る。
	backupStatus(): Promise<BackupStatus>;
	/** いまの中身を書き出す。ここでは「バックアップした」ことにしない。
	 *
	 *  ファイルが親の手元に残ったかは、書き出した側からは分からない——共有シートを
	 *  閉じても、ダウンロードが止められても、こちらには何も返ってこない。届く前に
	 *  記録すると「さいごのバックアップ: きょう」と出たまま催促が1週間消え、その間に
	 *  端末側の掃除で記録が消えると取り返しがつかない。
	 *  seq は「このファイルに入っている記録の通番」、exported_at は「作った時刻」。
	 *  どちらもそのまま backupMarkSaved に渡す。 */
	backupExportAll(): Promise<{
		filename: string;
		payload: unknown;
		seq: number;
		exported_at: number;
	}>;
	/** 書き出したファイルが手元にあると分かった時点で、催促の基準を進める。
	 *
	 *  seq / exportedAt は backupExportAll() が返した値をそのまま渡すこと。呼んだ時点の
	 *  ものにすると、書き出してから確かめるまでに付けたチェック（そのファイルには
	 *  入っていない）まで「バックアップ済み」に数え、日づけも実際より新しくなる
	 *  ＝どちらも「消えても戻せる」の見積もりを甘いほうへずらす。
	 *  recorded:false は進めなかった、の意味。そのファイルより新しい基準がもうある
	 *  （復元した・別のタブがもっと新しいものを書き出した）か、逆に手元の記録より
	 *  先を指している（保存が作り直された＝この記録の続きではない）とき。 */
	backupMarkSaved(seq: number, exportedAt: number): Promise<{ recorded: boolean }>;
	/** バックアップで丸ごと置き換える（取り込む前に画面側で確認を取ること）。 */
	backupImportAll(payload: unknown): Promise<{ ok: boolean }>;
	/** 「ホーム画面に追加」の案内を閉じた、を覚える。 */
	backupDismissHomeHint(): Promise<void>;
};

export type BackupStatus = {
	/** この版でバックアップの出番があるか（docker 版は false＝カードごと出さない）。 */
	supported: boolean;
	last_backup_at: number | null;
	/** 最後のバックアップ以降に何回書いたか。「6日前」より効く催促材料。 */
	changes_since_backup: number;
	/** navigator.storage.persist() の結果（まだ聞いていなければ null）。 */
	persisted: boolean | null;
	/** この端末では記録がまったく残らない（IndexedDB が使えなかった）。
	 *
	 *  プライベートブラウズなどで起きる。黙って受け付けると、夏休みぶんの設定を
	 *  入れ終わったあとタブを閉じた瞬間に全部消える。画面はこれを見て強く警告する。 */
	storage_ephemeral: boolean;
	home_hint_dismissed: boolean;
};

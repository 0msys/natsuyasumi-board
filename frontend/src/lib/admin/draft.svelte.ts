// 編集中ドキュメント全体を保持するドラフトストア（/admin/[child] ページの単一真実源）。
// doc は $state の深いプロキシ＝各セクションエディタが直接ミューテートし markDirty() を呼ぶ。
// 保存は「validate（ドライラン）→ errors 無しなら PUT（楽観ロック）」。409 は conflict を
// 立て、ページ側が「読み直す」ボタンを出す。
import { api } from '$lib/api';
import type { AdminDefinitionEntry, AdminDocument, ValidationIssue } from '$lib/api';
import { errorDetail, errorStatus } from '$lib/api/apiError';
import type { DefinitionDoc } from './docTypes';

export class AdminDraft {
	doc = $state<DefinitionDoc | null>(null);
	child = $state('');
	year = $state(0); // 編集中の年
	years = $state<number[]>([]); // その子に登録されている年（年タブ用）
	revision = $state(0);
	dirty = $state(false);
	saving = $state(false);
	validating = $state(false);
	conflict = $state(false);
	errors = $state<ValidationIssue[]>([]);
	warnings = $state<ValidationIssue[]>([]);
	saveError = $state<string | null>(null);
	savedAt = $state<number | null>(null);

	// 読み込んだ定義の世代。initFrom で中身が入れ替わるたびに進む。画面はこれを見て
	// 「この定義はまだ検証していない」を判断する——子どもと年で見ると、保存競合のあと
	// 同じ子・同じ年を読み直した場合を取りこぼす（initFrom が警告を消したまま戻らない）。
	generation = $state(0);

	// 検証の世代。応答を書き戻してよいのは最後に投げた1本だけ（下の validate() を参照）。
	// generation とは別物: こちらは validate() のたびに進むので、画面が見ると回り続ける。
	#validateSeq = 0;

	/** load 結果（SSR）や保存レスポンスの entry からまるごと初期化する. */
	initFrom(entry: AdminDefinitionEntry): void {
		this.doc = entry.doc as DefinitionDoc;
		this.child = entry.child;
		this.year = entry.year;
		this.years = entry.years ?? [entry.year];
		this.revision = entry.revision;
		this.dirty = false;
		this.conflict = false;
		this.errors = [];
		this.warnings = [];
		this.saveError = null;
		this.savedAt = null;
		// 中身が入れ替わった＝飛んでいる検証の応答はもう別物。捨てて、世代を進める。
		this.#validateSeq++;
		this.validating = false;
		this.generation++;
	}

	/** サーバから読み直す（409 後の「読み直す」ボタン用）。編集中の年のまま読む. */
	async load(child: string, year?: number): Promise<void> {
		this.initFrom(await api.adminGetDefinition(child, year ?? (this.year || undefined)));
	}

	/** 各エディタの変更で呼ぶ. */
	markDirty(): void {
		this.dirty = true;
		this.savedAt = null;
	}

	/** $state プロキシを JSON 送信できる素のオブジェクトへ. */
	private snapshot(): AdminDocument {
		return $state.snapshot(this.doc) as unknown as AdminDocument;
	}

	/** ドライラン検証（保存しない）。errors が無ければ true.
	 *
	 *  応答を errors / warnings へ書き戻すのは、最後に投げた1本だけ。追い越された古い応答は
	 *  捨てる。画面を開いた時点の検証が飛んでいる最中に、保存や年の切替でもう1本走ることが
	 *  あり、順不同で返ると古いほうが新しい結果を消してしまう——「保存できなかったのに
	 *  理由が1つも出ていない」「切り替えた年に、前の年の指摘が出ている」になる。
	 *  返り値（ok）は呼び出し元が自分の応答について判断するものなので、そのまま返す。 */
	async validate(): Promise<boolean> {
		if (!this.doc) return false;
		const seq = ++this.#validateSeq;
		this.validating = true;
		try {
			const res = await api.adminValidateDefinition(this.child, this.snapshot());
			if (seq === this.#validateSeq) {
				this.errors = res.errors;
				this.warnings = res.warnings;
			}
			return res.ok;
		} finally {
			// 追い越されているなら、新しいほうがまだ走っている＝旗は下ろさない
			if (seq === this.#validateSeq) this.validating = false;
		}
	}

	/** validate → エラーが無ければ保存。保存成功でサーバ採番済み doc / revision に置き換わる. */
	async save(): Promise<boolean> {
		if (!this.doc || this.saving) return false;
		this.saving = true;
		this.saveError = null;
		this.conflict = false;
		try {
			let ok: boolean;
			try {
				ok = await this.validate();
			} catch (e) {
				this.saveError = errorDetail(e);
				return false;
			}
			if (!ok) return false; // エラーは IssueList に出る（保存は中断）
			// 保存先は編集中の年（省略するとサーバ既定の年＝別の年に書きうる）
			const entry = await api.adminSaveDefinition(
				this.child,
				this.snapshot(),
				this.revision,
				this.year || undefined
			);
			this.doc = entry.doc as DefinitionDoc;
			this.revision = entry.revision;
			this.year = entry.year;
			this.dirty = false;
			this.savedAt = Date.now();
			return true;
		} catch (e) {
			if (errorStatus(e) === 409) this.conflict = true;
			else this.saveError = errorDetail(e);
			return false;
		} finally {
			this.saving = false;
		}
	}
}

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

	/** ドライラン検証（保存しない）。errors が無ければ true. */
	async validate(): Promise<boolean> {
		if (!this.doc) return false;
		this.validating = true;
		try {
			const res = await api.adminValidateDefinition(this.child, this.snapshot());
			this.errors = res.errors;
			this.warnings = res.warnings;
			return res.ok;
		} finally {
			this.validating = false;
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

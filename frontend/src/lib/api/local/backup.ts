// まるごとバックアップの api（lite だけ）。
import { nowEpochSec } from '$lib/core/clock';
import { isStorageUnavailable, mutate, read, replaceAll } from '$lib/store/db';
import { buildBackup, parseBackup } from '$lib/store/backup';
import { ApiError } from '../contract';

/** 保存の持続をブラウザに頼む。断られても案内は出さない（親に打つ手が無い）。 */
async function askPersist(): Promise<boolean | null> {
	try {
		if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
		if (await navigator.storage.persisted?.()) return true;
		return await navigator.storage.persist();
	} catch {
		return null;
	}
}

/** 持続を頼むのは1セッションに1回でよい（結果は meta に残る）。 */
let persistenceAsked = false;

export const backupApi = {
	backupStatus: async () => {
		// まだ聞いていなければ、裏で頼んでおく。答えは次に開いたときの表示に効く。
		// ここで待たないのは、断られても親に打つ手が無く、待たせる意味がないため。
		if (!persistenceAsked) {
			persistenceAsked = true;
			void read((db) => db.meta.persisted).then(async (known) => {
				if (known !== null) return;
				const granted = await askPersist();
				await mutate((db) => {
					db.meta.persisted = granted;
				});
			});
		}
		return read((db) => ({
			supported: true,
			last_backup_at: db.meta.last_backup_at,
			// 「6日前」より「そのあと32件つけた」のほうが、催促として効く
			changes_since_backup: Math.max(0, db.meta.seq - db.meta.last_backup_seq),
			persisted: db.meta.persisted,
			storage_ephemeral: isStorageUnavailable(),
			home_hint_dismissed: db.meta.home_hint_dismissed
		}));
	},

	backupExportAll: () =>
		mutate((db) => {
			const now = nowEpochSec();
			const built = buildBackup(db, now);
			// 「いつ・どこまで出したか」を覚えて、次の催促の基準にする
			db.meta.last_backup_at = now;
			db.meta.last_backup_seq = db.meta.seq;
			return built;
		}),

	backupImportAll: async (payload: unknown) => {
		// 置きかえる前に中身を確かめる。壊れたファイルで空にしてしまうと、
		// 元の記録はもうどこにも無い。
		let db;
		try {
			db = parseBackup(payload);
		} catch (e) {
			throw new ApiError(400, e instanceof Error ? e.message : String(e));
		}
		// ここから先は丸ごと置き換え。呼ぶ前に画面側で確認を取ること。
		await replaceAll(db);
		return { ok: true };
	},

	backupDismissHomeHint: () =>
		mutate((db) => {
			db.meta.home_hint_dismissed = true;
		}).then(() => undefined)
};

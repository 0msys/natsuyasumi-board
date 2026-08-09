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
			void read((db) => db.meta.persisted)
				.then(async (known) => {
					if (known !== null) return;
					const granted = await askPersist();
					// 記録は1つも変わっていない。local を外すと、persist が使えない端末では
					// これがタブを開くたびに走り、「そのあと N件」だけが積み上がる。
					await mutate(
						(db) => {
							db.meta.persisted = granted;
						},
						{ local: true }
					);
				})
				.catch(() => {
					// 保存が読めなかった／書けなかっただけ。次に開いたときに頼み直せるよう戻す。
					// ここを付けずに転ばせると、誰も掴まない拒否になるうえ、「頼んだ」の印だけが
					// 立って iOS の7日削除への備えがそのタブでは二度と効かない。
					persistenceAsked = false;
				});
		}
		return read((db) => ({
			supported: true,
			last_backup_at: db.meta.last_backup_at,
			// 「6日前」より「そのあと32件つけた」のほうが、催促として効く。
			// seq は記録が変わった書き込みでしか上がらないので、ここは引き算だけでよい。
			changes_since_backup: Math.max(0, db.meta.seq - db.meta.last_backup_seq),
			persisted: db.meta.persisted,
			storage_ephemeral: isStorageUnavailable(),
			home_hint_dismissed: db.meta.home_hint_dismissed
		}));
	},

	backupExportAll: () =>
		// 書き出しそのものは記録を変えない（local）。
		//
		// 読むだけだが read ではなく mutate を通す。read は書き込みの鍵の外なので、
		// 別のタブが「いま書いている途中」の1件を含まないファイルが出ることがある。
		// バックアップで1件落とすのは、この機能の目的そのものに反する。
		mutate(
			(db) => {
				// 「いつ・どこまで出したか」は、ここでは記録しない。
				// ファイルが親の手元にあると分かってから backupMarkSaved(seq) が記録する。
				// ここで記録していたころは、共有シートを閉じただけでも「さいごの
				// バックアップ: きょう」になり、催促が1週間消えていた。
				const now = nowEpochSec();
				const built = buildBackup(db, now);
				return { ...built, seq: db.meta.seq, exported_at: now };
			},
			{ local: true }
		),

	backupMarkSaved: (seq: number, exportedAt: number) =>
		// 催促の基準を進めるだけで、記録は変わっていない（local）。local を外すと通番が
		// 上がり、印を付けただけで他のタブの催促に1件積む。
		mutate(
			(db) => {
				// 手元の記録より先を指すファイルは、この記録の続きではない。数を合わせに
				// いってはいけない——保存が作り直された端末（IndexedDB が消えて作り直され、
				// 通番が 0 から振り直された）では、そのファイルに入っていない新しい記録まで
				// 「済み」に数えることになる。分からないときは進めない（催促は残る）。
				if (seq > db.meta.seq) return { recorded: false };
				// 基準は戻さない。待っているあいだに復元した／別のタブがもっと新しいものを
				// 書き出した、というときに古い「ほぞんできた」が遅れて届くことがある。
				// そこで戻すと、手元に無いファイルの分まで「まだ」に戻り、復元した直後に
				// 「そのあと N件」と出る。
				if (seq < db.meta.last_backup_seq) return { recorded: false };
				// 2つの欄は必ずいっしょに動かす。片方だけ動くと「さいごのバックアップ」と
				// 「そのあと N件」が別々のファイルの話になる。
				db.meta.last_backup_seq = seq;
				// 日づけは「確かめた時刻」ではなく「そのファイルを作った時刻」。催促が測って
				// いるのは手元のファイルの古さなので、問いかけを開いたまま何日も置いてから
				// 答えると、1週間前のファイルが「きょう」になって次の催促がさらに遅れる。
				// 先の時刻は受け取らない（時計を進めた端末で書き出したファイルを、あとから
				// 別の端末で確かめると未来になる）。
				db.meta.last_backup_at = Math.min(exportedAt, nowEpochSec());
				return { recorded: true };
			},
			{ local: true }
		),

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
		// 案内を閉じただけ。記録は変わっていない。
		mutate(
			(db) => {
				db.meta.home_hint_dismissed = true;
			},
			{ local: true }
		).then(() => undefined)
};

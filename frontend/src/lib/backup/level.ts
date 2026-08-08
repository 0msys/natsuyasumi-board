// バックアップの催促をどれくらい強く出すか、を決めるただ1か所。
//
// しきい値の判定を、子どもページの歯車バッジと BackupCard に別々に書いていたら
// 丸一日ずれた。片方は小数のままの日数で、もう片方は切り捨てた日数で見ていて、
// 「さいごのバックアップ: 7日前（強調なし）」と書いてあるカードの隣で歯車にだけ
// 赤い印が点く、という状態が1日続く。保護者は開いても直すものを見つけられず、
// 「あの印は当てにならない」と学習する——催促はデータ消失を防ぐための仕掛けなので、
// 無視されたら仕掛けごと無意味になる。だから2か所で判定しない。
import type { BackupStatus } from '$lib/api';

/** 何日ぶん空いたら催促するか。数えかたは画面の「N日前」と同じ（切り捨て）。 */
export const BACKUP_STALE_DAYS = 7;
/** バックアップのあと、何件たまったら催促するか。 */
export const BACKUP_STALE_CHANGES = 50;

/** 催促の強さ。danger=まだ一度も出していない、warn=しきい値超え、ok=そのまま。 */
export type BackupLevel = 'ok' | 'warn' | 'danger';

type BackupTiming = Pick<BackupStatus, 'last_backup_at' | 'changes_since_backup'>;

/**
 * さいごのバックアップからの日数。まだ一度も出していなければ null。
 *
 * 表示にも判定にもこの値を使う。別々に数えると、また丸一日ずれる。
 * 端末の時計が巻き戻って未来の日時になっていても「-1日前」とは出さない。
 */
export function daysSinceBackup(status: BackupTiming, now: number = Date.now()): number | null {
	if (status.last_backup_at === null) return null;
	return Math.max(0, Math.floor((now / 1000 - status.last_backup_at) / 86400));
}

/**
 * 催促の強さ。
 *
 * 日数はしきい値**以上**で警告に上げる（7.0日ではなく「7日前」と表示された時点）。
 * 出したい印と画面の数字が同じ日に変わるほうが、保護者にとって筋が通る。
 */
export function backupLevel(status: BackupTiming, now: number = Date.now()): BackupLevel {
	const days = daysSinceBackup(status, now);
	if (days === null) return 'danger';
	return days >= BACKUP_STALE_DAYS || status.changes_since_backup > BACKUP_STALE_CHANGES
		? 'warn'
		: 'ok';
}

// まるごとバックアップの書き出しと取り込み。
//
// lite の記録はブラウザの中にしかない。iOS Safari は「7日間ひらかなかったサイト」の
// 保存データを消すことがあり（ホーム画面に追加したものは対象外）、端末の買い替えでも
// 当然消える。夏休みのあいだ積み上げた記録が消えるのは痛いので、いつでも1ファイルに
// 出せて、そこから丸ごと戻せるようにしておく。
import { todayJst } from '$lib/core/clock';
import { BACKUP_FORMAT, looksLikeBackup } from '$lib/backup/format';
import { SCHEMA_VERSION, normalizeDb, type Db } from './model';

export { BACKUP_FORMAT };
export const BACKUP_VERSION = 1;

export type BackupPayload = {
	format: typeof BACKUP_FORMAT;
	version: number;
	exported_at: number;
	schema_version: number;
	db: Db;
};

/** 取り込もうとしているものが、まるごとバックアップか（定義1件の JSON と区別する）。 */
export const isBackupPayload = (raw: unknown): raw is BackupPayload => looksLikeBackup(raw);

export function buildBackup(db: Db, now: number): { filename: string; payload: BackupPayload } {
	return {
		filename: `natsuyasumi-board-${todayJst()}.json`,
		payload: {
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			exported_at: now,
			schema_version: SCHEMA_VERSION,
			db
		}
	};
}

/**
 * 取り込む前に、いまのコードが読める形へそろえる。
 *
 * version 1 のいまは中身を触らないが、入口を最初から1本用意しておく。ここが無いと、
 * 形を変えたときに「去年のバックアップが読めない」ことに後から気づくことになる。
 */
export function migrate(payload: BackupPayload): Db {
	if (payload.version > BACKUP_VERSION) {
		throw new Error(
			'このバックアップは新しいバージョンで作られています（アプリを更新してから取り込んでください）'
		);
	}
	return normalizeDb(payload.db);
}

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

/** 取り込もうとしているものが、まるごとバックアップ**らしい**か。
 *
 *  これは「どちらの取り込み口へ回すか」を決めるための目印で、中身の検査ではない。
 *  取り込む前には必ず parseBackup() を通すこと。 */
export const isBackupPayload = (raw: unknown): raw is BackupPayload => looksLikeBackup(raw);

const isMap = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 取り込めるバックアップかを確かめて、中身を取り出す。読めなければ理由をつけて投げる。
 *
 * ここを目印（format 文字列）だけで通してはいけない。復元は**いまの記録を全部
 * 置きかえる**操作なので、途中で切れたファイルや別物を受け取ると、空のまま
 * 上書きして夏休みぶんの記録が消える。壊れているなら、置きかえずに断る。
 */
export function parseBackup(raw: unknown): Db {
	if (!looksLikeBackup(raw)) {
		throw new Error('これはバックアップのファイルではないようです');
	}
	const payload = raw as Partial<BackupPayload>;
	const version = payload.version;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		throw new Error('バックアップの形式が読み取れませんでした（version がありません）');
	}
	if (version > BACKUP_VERSION) {
		throw new Error(
			'このバックアップは新しいバージョンで作られています（アプリを更新してから取り込んでください）'
		);
	}
	const db = payload.db;
	// 中身がそろっているか。正しく書き出したものには必ず全部ある。
	const required = ['definitions', 'daily_checks', 'flags'] as const;
	if (!isMap(db) || required.some((key) => !isMap((db as Record<string, unknown>)[key]))) {
		throw new Error('バックアップの中身が足りません（途中で切れたファイルかもしれません）');
	}
	return normalizeDb(db);
}

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

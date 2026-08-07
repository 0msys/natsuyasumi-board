// バックアップファイルの見分けかた。
//
// 画面には JSON の取り込み口が2つある（設定1件のインポートと、まるごと復元）。
// 利用者にその区別を押しつけないため、どちらに入れても中身を見て振り分ける。
// ここは docker 版の画面からも読むので、保存層（lite だけ）には依存させない。
export const BACKUP_FORMAT = 'natsuyasumi-board/backup';

/** まるごとバックアップのファイルか（設定1件の JSON と見分ける）。 */
export const looksLikeBackup = (raw: unknown): boolean =>
	typeof raw === 'object' &&
	raw !== null &&
	(raw as { format?: unknown }).format === BACKUP_FORMAT;

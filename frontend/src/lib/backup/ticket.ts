// 書き出したファイルの控えと、まだ答えてもらっていない問いかけ。
//
// 保存層（$lib/store/model の Meta）と api の契約（$lib/api/contract）の両方が同じ形を要る。
// 契約側に置くと保存層が api を参照することになり、依存の向きが逆さになる（いまは
// api/local/* → store の一方通行）。format.ts と同じく、どちらからも読める版中立の置き場は
// ここしかない。

/** 書き出したファイルが「何であるか」の控え。書き出しが渡し、確かめるときに返す。
 *
 *  3つとも「そのファイル」の話で、確かめた時点の話ではない。ここを呼んだ時点の値に
 *  すり替えると、ファイルに入っていないものまで済みに数える。 */
export type BackupTicket = {
	/** そのファイルに入っている記録の通番。 */
	seq: number;
	/** そのファイルを作った時刻（催促が測るのは、手元のファイルの古さ）。 */
	exported_at: number;
	/** 書き出したときの保存の世代（作り直された保存を、通番の大小と別に見分ける）。 */
	storage_id: string;
};

/**
 * ブラウザに渡したのに、まだ「ほぞんできた？」を聞けていないファイル。
 *
 * 控えを入れ子にしてあるのは、`backupMarkSaved({ ...pending })` と書ける道を作らないため。
 * 平らな型にすると filename まで控えに混ざり、「控えは3つきり」という上の約束が崩れる。
 * 渡しかたを `backupMarkSaved(pending.ticket)` の一本にしておけば、型が見張ってくれる。
 */
export type PendingBackup = {
	ticket: BackupTicket;
	/** 親に「どのファイルの話か」を示すためだけの欄（控えには入れない）。 */
	filename: string;
};

/** 同じ書き出しの控えか（押し直しリンクが、いま出ているファイルを指しているかの判定）。 */
export const sameBackupFile = (a: BackupTicket, b: BackupTicket): boolean =>
	a.seq === b.seq && a.exported_at === b.exported_at && a.storage_id === b.storage_id;

// まるごとバックアップの書き出しと取り込み。
//
// lite の記録はブラウザの中にしかない。iOS Safari は「7日間ひらかなかったサイト」の
// 保存データを消すことがあり（ホーム画面に追加したものは対象外）、端末の買い替えでも
// 当然消える。夏休みのあいだ積み上げた記録が消えるのは痛いので、いつでも1ファイルに
// 出せて、そこから丸ごと戻せるようにしておく。
import { todayJst } from '$lib/core/clock';
import { BACKUP_FORMAT, looksLikeBackup } from '$lib/backup/format';
import { SCHEMA_VERSION, normalizeDb, splitKey, type Db } from './model';

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
	if (!isMap(db)) {
		throw new Error('バックアップの中身が足りません（途中で切れたファイルかもしれません）');
	}

	// 区画があるかだけでなく、1行ずつ形を見る。
	//
	// ここを「マップならよい」で通すと、definitions: { "x": null } のようなものが
	// そのまま入り、置きかえたあとに一覧が row.child を読んで落ちる＝記録を失ったうえに
	// アプリが開けなくなる。置きかえは元に戻せないので、疑わしいものは入れない。
	for (const [section, checkRow] of Object.entries(ROW_CHECKS)) {
		const table = (db as Record<string, unknown>)[section];
		if (table === undefined) continue; // 区画ごと無いのは normalizeDb が埋める
		if (!isMap(table)) {
			throw new Error(`バックアップの「${section}」が壊れています`);
		}
		for (const [key, row] of Object.entries(table)) {
			if (!checkRow(row)) {
				throw new Error(`バックアップの「${section}」に読めない記録があります（${key}）`);
			}
		}
	}
	// 正しく書き出したものには必ずある区画
	for (const section of ['definitions', 'daily_checks', 'flags'] as const) {
		if (!isMap((db as Record<string, unknown>)[section])) {
			throw new Error('バックアップの中身が足りません（途中で切れたファイルかもしれません）');
		}
	}

	// キーそのものの形も見る。
	//
	// 記録のキーは決まった数の部品を区切りでつないだもの。名前や項目キーに区切りが
	// 混ざっていると部品の数が変わり、読むときに別のものとして切り分けられる
	// ＝復元は成功したのに、その子の記録が出てこない。定義を取り込む道には
	// 同じ検査を入れてあるが（api/local/admin.ts）、バックアップからの復元は
	// キーを直接持ち込むので、こちらにも要る。
	for (const [section, parts] of Object.entries(KEY_PARTS)) {
		const table = (db as Record<string, unknown>)[section];
		if (!isMap(table)) continue;
		for (const key of Object.keys(table)) {
			const split = splitKey(key);
			if (split.length !== parts || split.some((part) => part === '')) {
				throw new Error(`バックアップの「${section}」に、読めないキーがあります`);
			}
		}
	}
	// 定義はキーと中身の両方に子ども名と年を持つ。食い違っていると、
	// 一覧には出るのに開けない（またはその逆）という states になる。
	const definitions = (db as Record<string, unknown>).definitions as Record<string, DefinitionLike>;
	for (const [key, row] of Object.entries(definitions)) {
		const [child, year] = splitKey(key);
		if (row.child !== child || String(row.year) !== year) {
			throw new Error('バックアップの「definitions」で、キーと中身が食い違っています');
		}
	}
	return normalizeDb(db);
}

type DefinitionLike = { child: string; year: number };

/** 区画ごとの、キーを区切りで割ったときの部品の数。 */
const KEY_PARTS: Record<string, number> = {
	definitions: 2, // 名前・年
	definition_history: 2, // 名前・年
	daily_checks: 3, // 名前・日付・項目キー
	flags: 2, // 名前・項目キー
	media_timer: 2 // 名前・日付
};

const isInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);

/** 区画ごとの、1行に最低限そろっていてほしいもの。
 *
 *  ここに挙げるのは「読む側が実際に触る欄」だけにする。将来ふえた欄まで必須にすると、
 *  古いバックアップが読めなくなる。 */
const ROW_CHECKS: Record<string, (row: unknown) => boolean> = {
	definitions: (row) =>
		isMap(row) &&
		typeof row.child === 'string' &&
		isInt(row.year) &&
		isMap(row.doc) &&
		isInt(row.revision),
	definition_history: (rows) =>
		Array.isArray(rows) && rows.every((r) => isMap(r) && isInt(r.revision) && isMap(r.doc)),
	daily_checks: (row) => isMap(row) && typeof row.status === 'string',
	flags: (row) => isMap(row) && isInt(row.value),
	media_timer: (row) =>
		isMap(row) && isInt(row.accumulated_seconds) && typeof row.running === 'boolean'
};

export function buildBackup(db: Db, now: number): { filename: string; payload: BackupPayload } {
	// 生きている中身をそのまま渡さない。受け取った側が触ると本体が変わってしまう
	// ——書き出しは「そのときの写し」であるべきで、参照を配る場所ではない。
	const copy = JSON.parse(JSON.stringify(db)) as Db;
	// 未回答の問いかけは、この端末だけの話。ファイルに乗せると、それを取り込んだ端末に
	// 「一度も書き出していないのに、別世代の印を持つ問いかけ」が現れる。受け取った側は
	// 答えようがない（保存側も世代違いで断る）ので、出さない。
	//
	// 落とす場所をここにしてあるのは、呼ぶ順序に依らない一点保証にするため。問いかけを
	// 覚えるのは書き出しとは別の書き込みなので、「2回目の書き出しに1回目の控えが乗る」
	// 経路が実在する。写しを作る側で必ず落としておけば、その並びを気にしなくてよい。
	copy.meta.pending_backup = null;
	return {
		filename: `natsuyasumi-board-${todayJst()}.json`,
		payload: {
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			exported_at: now,
			schema_version: SCHEMA_VERSION,
			db: copy
		}
	};
}

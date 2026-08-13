// まるごとバックアップの api（lite だけ）。
import { nowEpochSec } from '$lib/core/clock';
import { isStorageUnavailable, mutate, read, replaceAll } from '$lib/store/db';
import { buildBackup, parseBackup } from '$lib/store/backup';
import type { Meta } from '$lib/store/model';
import { sameBackupFile } from '$lib/backup/ticket';
import { ApiError, type BackupTicket, type PendingBackup } from '../contract';


/** 保存の世代につける印。作り直された保存と別物になればよく、当てにくさは要らない。 */
const newStorageId = (): string =>
	`${nowEpochSec().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

/**
 * その控えで、催促の基準を進められるか。
 *
 * 「ほぞんできた」を受け取る条件そのもの。判定を1か所に置いてあるのは、確かめるとき
 * （backupMarkSaved）と問いかけを出すとき（backupStatus）で答えが食い違わないようにするため。
 * 食い違うと、押しても必ず「合わなくなっていた」と返るだけの問いかけを親の前に置くことになる
 * ——この欄を知らない版のタブが「ほぞんできた」を記録すると、実際にその状態が作れる。
 */
function acceptableTicket(meta: Meta, ticket: BackupTicket, now: number): boolean {
	// 別の世代の保存で書き出したファイルは、通番が届いていても受け取らない。
	// 保存が作り直されると通番は 0 から振り直されるので、消される前に書き出した
	// ファイルの通番に、入れ直した記録がそのうち追いつく。そこで数だけを見て
	// 通すと、そのファイルに入っていない記録まで「済み」になる——催促は黙るのに、
	// 戻せる先はどこにも無い。大小ではなく、同じ世代かどうかで決める。
	if (ticket.storage_id !== meta.storage_id) return false;
	// 同じ世代なら通番は比べられる。手元の記録より先を指すことは無いはずだが、
	// 念のため受け取らない（先を刻むと changes_since_backup が 0 に潰れたまま
	// 戻らず、そのあと何を書いても催促が出なくなる）。
	if (ticket.seq > meta.seq) return false;
	// 基準は戻さない。待っているあいだに復元した／別のタブがもっと新しいものを
	// 書き出した、というときに古い「ほぞんできた」が遅れて届くことがある。
	// そこで戻すと、手元に無いファイルの分まで「まだ」に戻り、復元した直後に
	// 「そのあと N件」と出る。
	if (ticket.seq < meta.last_backup_seq) return false;
	// 日づけは「確かめた時刻」ではなく「そのファイルを作った時刻」。催促が測って
	// いるのは手元のファイルの古さなので、問いかけを開いたまま何日も置いてから
	// 答えると、1週間前のファイルが「きょう」になって次の催促がさらに遅れる。
	//
	// その時刻が「いま」より先を指しているなら、決めようがないので受け取らない。
	// 書き出したときは時計が進んでいて、そのあと直った、という状態。ここで「いま」
	// まで丸めると、何日も前のファイルを「きょう作った」ことにしてしまう——丸めた
	// 値はどのファイルの時刻でもない。2つの欄はいっしょにしか動かせないので、
	// 日づけの決められない控えは丸ごと断る（催促は残り、書き出し直せばすぐ済む）。
	if (ticket.exported_at > now) return false;
	return true;
}

/**
 * 覚えておく問いかけを1つ選ぶ。**新しく書き出したほう**を残す。
 *
 * 届いた順に上書きしてはいけない。書き出しは「ブラウザに渡す」→「覚える」の2段になっていて、
 * そのあいだでタブが止まりうる（背景に回された iOS のタブがまさにそれで、この仕掛けは
 * そこで問いかけが消えることを直しにきている）。止まっているあいだに別のタブが書き出しを
 * 終えていると、遅れて再開した**古いほうが新しい問いかけを踏み潰す**。親は古いファイルに
 * ついて聞かれ、それに答えると、あとから書き出したファイルを確かめる口はどこにも残らない。
 *
 * 並べる物差しは通番を先にする。保存の世代が同じあいだ通番は下がらないので、時計に依らない。
 * 同じ通番なら記録は1件も変わっていない＝中身の同じファイルなので、書き出した時刻で決める
 * （そこも並びなら、入っているものを残す。どちらを聞いても同じことになる）。
 */
function newerPending(stored: PendingBackup | null, incoming: PendingBackup): PendingBackup {
	if (!stored) return incoming;
	// 世代が違う控えは、もう受け取れない（acceptableTicket が断る）。生きているほうを採る。
	if (stored.ticket.storage_id !== incoming.ticket.storage_id) return incoming;
	if (incoming.ticket.seq !== stored.ticket.seq) {
		return incoming.ticket.seq > stored.ticket.seq ? incoming : stored;
	}
	return incoming.ticket.exported_at > stored.ticket.exported_at ? incoming : stored;
}

/**
 * 答えてもらったファイルの問いかけを下げる。**そのファイルのものだけ**を下げる。
 *
 * 見ないで消してはいけない。タブが2つあると、こちらが問いかけを描いたあとに、もう一方が
 * 書き出して控えを置きかえていることがある——そのときファイルは2つとも端末にある。ここで
 * 無条件に消すと、あとから書き出したほうを確かめる口が（開き直した先も含めて）どこにも
 * 無くなる。それはこの仕掛けが直そうとしている壊れかたそのもの。
 *
 * 置きかえられていたら、残っているのは新しいほうの問いかけ。そのまま残す＝あとで答えられる。
 */
function dropAnsweredPending(meta: Meta, answered: BackupTicket): void {
	if (meta.pending_backup && sameBackupFile(meta.pending_backup.ticket, answered)) {
		meta.pending_backup = null;
	}
}

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
			// もう受け取れない控えは、問いかけとして出さない。押しても「合わなくなって
			// いた」としか返せない問いかけは、親の手を煩わせるだけで何も進まない。
			//
			// 伏せるだけで、消しはしない。ここは読みの経路で、状態を見にいっただけで
			// 書き込みが走るようにはしたくない（見るたびに書くと、多タブの取り合いと
			// 保存の持続を聞く裏の書き込みに、意味の無い1件を割り込ませることになる）。
			// 死んだ控えは、次の書き出しか次の答えで上書きされて消える。
			pending_backup:
				db.meta.pending_backup &&
				acceptableTicket(db.meta, db.meta.pending_backup.ticket, nowEpochSec())
					? db.meta.pending_backup
					: null,
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
				// 保存の世代は、はじめて書き出すときに刻む（この欄のためだけに全員へ
				// 書き込みを走らせない）。作り直された保存には無いので、そこで別物になる。
				db.meta.storage_id ??= newStorageId();
				return {
					...built,
					ticket: { seq: db.meta.seq, exported_at: now, storage_id: db.meta.storage_id }
				};
			},
			{ local: true }
		),

	backupNotePending: (pending: PendingBackup) =>
		// ブラウザに渡せたので、あとで聞けるように覚えておく。
		//
		// 記録は1件も変わっていない（local）。local を外すと、書き出すたびに催促の
		// 「そのあと N件」が1つ増える——押した人を数えることになる。
		//
		// 呼ぶのは「渡せた」と分かってから（画面側）。覚えるのは1つだけで、あとから
		// 書き出したものに置きかわる。2度押しでも2つのタブでも、親に出る問いかけは
		// いちばん新しいファイルについての1つになる。
		mutate(
			(db) => {
				db.meta.pending_backup = newerPending(db.meta.pending_backup, pending);
			},
			{ local: true }
		).then(() => undefined),

	backupDismissPending: (ticket: BackupTicket) =>
		// 「できていない」と答えられた。問いかけを下げるだけで、何も記録しない（local）。
		// 催促はそのまま残るので、書き出し直せばすぐ済む。
		mutate(
			(db) => {
				dropAnsweredPending(db.meta, ticket);
			},
			{ local: true }
		).then(() => undefined),

	backupMarkSaved: (ticket: BackupTicket) =>
		// 催促の基準を進めるだけで、記録は変わっていない（local）。local を外すと通番が
		// 上がり、印を付けただけで他のタブの催促に1件積む。
		mutate(
			(db) => {
				const { seq, exported_at } = ticket;
				const now = nowEpochSec();
				// 答えられたファイルの問いかけだけを下げる。受け取れたかどうかは問わない
				// （受け取れなかったときは画面が理由を出して書き出し直しを促すので、同じ
				// 問いかけをもう一度出しても押し直させるだけ）。
				dropAnsweredPending(db.meta, ticket);
				if (!acceptableTicket(db.meta, ticket, now)) return { recorded: false };

				// 2つの欄は必ずいっしょに動かす。片方だけ動くと「さいごのバックアップ」と
				// 「そのあと N件」が別々のファイルの話になる。
				db.meta.last_backup_seq = seq;
				// 日づけは戻さない。記録が変わらないうちに2つのタブで書き出すと、どちらの控えも
				// 同じ通番になって acceptableTicket をすり抜ける。新しいほうを確かめたあとに古いほうの
				// 「ほぞんできた」が届くと、より新しいファイルが手元にあるのに催促が早く出る。
				// どちらのファイルも本物なので断りはしない（断ると、ちゃんと保存した親に
				// 「合わなくなっていた」と言うことになる）。覚えるほうを新しいものに寄せる。
				//
				// ただし、いま入っている日づけが未来なら比べる相手から外す。未来が入るのは、
				// 時計が進んでいた端末で取ったバックアップから復元したとき。抱えこむと、時計が
				// 直っても日数が0のまま張りつき、確かめ直しても上書きされない＝催促が二度と
				// 出ない。ここも「いま」に丸めてから比べてはいけない（丸めた値が、3日前の
				// ファイルの時刻に勝ってしまう）。
				const known = db.meta.last_backup_at ?? 0;
				db.meta.last_backup_at = known > now ? exported_at : Math.max(exported_at, known);
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

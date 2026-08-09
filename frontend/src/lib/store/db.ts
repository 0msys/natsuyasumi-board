// 保存の入口。読みはメモリ上の1本のドキュメント、書きは直列化して保存へ流す。
import { emptyDb, normalizeDb, type Db } from './model';
import { IdbTransactionError, idbAvailable, idbPersistence } from './idb';
import { memoryPersistence, type Persistence } from './persist';

/** 多タブへ「書いたよ」を知らせる通路。 */
const CHANNEL = 'nyb';
/** 読んで書き換えて書き戻すまでを、タブをまたいで1つずつにするための鍵。 */
const LOCK = 'nyb-write';

let persistence: Persistence | null = null;
let loaded: Db | null = null;
let loading: Promise<Db> | null = null;
// 書き込みを直列につなぐ鎖。並行して await すると、両方が同じ内容を読んでから
// 書き戻して片方の変更が消える（ロストアップデート）。
let chain: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
const watchers = new Set<(db: Db) => void>();
/** この端末で IndexedDB が使えないと分かったか（プライベートブラウズなど）。 */
let storageUnavailable = false;
/**
 * この端末で IndexedDB が使えると分かったか（読めた、あるいは開けはした）。
 *
 * 一度でも分かったら、以後の失敗は「使えない端末」ではなく一時的な障害として扱う。
 * 「読めたか」ではなく「使えると分かったか」なのが要点——開けたのに読みが転んだ回も
 * ここに含める。含めないと、そのあと open が転んだ拍子にまた空へ退避してしまい、
 * 元の記録は IndexedDB に、これから書く記録はメモリに、と離ればなれになる。
 */
let storageProven = false;
/** 退避を差し戻せる状態か（＝この端末では使えない、と確信していない）。 */
let memoryProvisional = false;
/** 退避するときにあきらめた保存。差し戻すときはこれを開き直す。 */
let abandoned: Persistence | null = null;
/** 差し戻しを試した回数と、その上限（開かない端末で毎回叩き続けないための歯止め）。 */
let recoveryProbes = 0;
const RECOVERY_PROBES = 3;

/** まだ差し戻しを試せるか。 */
const recoverable = (): boolean => memoryProvisional && recoveryProbes < RECOVERY_PROBES;

function pickPersistence(): Persistence {
	if (persistence) return persistence;
	// 名前ごと無い端末は、試すまでもなく使えない（差し戻しの余地も無い）。
	persistence = idbAvailable() ? idbPersistence() : fallbackToMemory();
	return persistence;
}

/**
 * IndexedDB が使えないので、その場かぎりの保存に切り替える。
 *
 * indexedDB という名前は生えているのに open すると拒否される環境がある
 * （Safari のプライベートブラウズなど）。名前の有無だけで決めると、以降の読み書きが
 * 全部失敗して画面がまったく出せなくなる。記録は残らないが、白い画面よりはよい
 * （残らないことは meta.persisted が null のままなので画面側から分かる）。
 *
 * ただし「開けなかった」だけなら、この端末で使えないと決めつけるには早い。provisional の
 * ときは退避を差し戻せる状態にしておき、退避先にまだ何も書いていないうちに開き直せたら
 * 本物へ戻す——戻しても何も失わないうちだけ戻す、というのがここの約束。
 */
function fallbackToMemory(provisional = false): Persistence {
	storageUnavailable = true;
	memoryProvisional = provisional;
	persistence = memoryPersistence();
	return persistence;
}

/** この端末では記録が残らない（IndexedDB が使えなかった）。 */
export const isStorageUnavailable = (): boolean => storageUnavailable;

/** 保存の実体を差し替える（テスト用）。読み込み済みの内容も捨てる。 */
export function setPersistence(next: Persistence | null): void {
	persistence = next;
	loaded = null;
	loading = null;
	chain = Promise.resolve();
	storageUnavailable = false;
	storageProven = false;
	memoryProvisional = false;
	abandoned = null;
	recoveryProbes = 0;
}

function ensureChannel(): void {
	if (channel || typeof BroadcastChannel === 'undefined') return;
	channel = new BroadcastChannel(CHANNEL);
	channel.onmessage = async () => {
		// 別のタブが書いた。手元の写しは古いので捨てる。
		loaded = null;
		loading = null;
		if (watchers.size === 0) return;
		// 読めなければ何も知らせない。load() は失敗を投げるようになったので、素通しにすると
		// 誰も受け取らない拒否になる（別のタブが書いただけで console にエラーが湧く）。
		const db = await load().catch(() => null);
		if (!db) return;
		for (const watch of watchers) watch(db);
	};
}

/** 他のタブの書き込みを受け取る（返り値を呼ぶと購読をやめる）。 */
export function watch(fn: (db: Db) => void): () => void {
	ensureChannel();
	watchers.add(fn);
	return () => watchers.delete(fn);
}

/**
 * 「読む → 書き換える → 書き戻す」を、タブをまたいで1つずつにする。
 *
 * 同じタブの中は下の chain で直列になるが、それだけでは足りない。2つのタブが
 * ほぼ同時に書くと、両方が同じ内容を読んでから書き戻して、あとから書いたほうが
 * 相手の変更を消す。全体を1本のドキュメントとして書き戻す作りなので、読みと
 * 書きのあいだに誰も割り込まないことを、保存の外側で保証する必要がある。
 *
 * Web Locks が無い端末（Safari 15.4 より前）では鍵なしで進む。そこは
 * 「同時に押さなければ壊れない」ままだが、鍵が無いことを理由に読み直しごと
 * やめてしまうより、できる範囲で狭めるほうがよい。
 */
function withWriteLock<T>(run: () => Promise<T>): Promise<T> {
	const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
	if (!locks?.request) return run();
	return locks.request(LOCK, run) as Promise<T>;
}

/**
 * 書き込みと同じ列に並べて実行する（このタブの中は chain、タブをまたぐぶんは鍵）。
 *
 * 「読む → 書き換える → 書き戻す」の途中に、保存そのものの差し替え（退避の差し戻し）が
 * 挟まってはいけない。挟まると、書き戻す先だけが差し替え前の古い保存のまま残り、
 * たったいま残した1件がどこからも読まれなくなる。フラグで「書き込み中か」を見るだけでは
 * 足りない——読み終わってからフラグを立てるまでのわずかな隙に割り込まれる。並べてしまえば、
 * その隙そのものが無くなる。
 */
function serialize<T>(run: () => Promise<T>): Promise<T> {
	const next = chain.then(() => withWriteLock(run));
	// 失敗しても鎖は続ける（1回の失敗で以降が全部詰まらないように）。
	chain = next.catch(() => undefined);
	return next;
}

/** 読み込みは1回の失敗で諦めない（接続を閉じられただけなら、開き直せば通る）。 */
const READ_ATTEMPTS = 2;

/** 開き直すまでの間。詰まりが解けるだけの間を空けないと、2回とも同じ理由で転ぶ。 */
const RETRY_PAUSE_MS = 150;

/** 読んだ中身と、それを読んだ保存。書き戻し先を取り違えないよう組で返す
 *  （退避の差し戻しが挟まると、空の写しを本物へ上書きしかねない）。 */
type ReadResult = { db: Db; store: Persistence };

/**
 * 保存を1回読む。「この端末で使えると分かった」の記録は、ここ1か所だけで行う。
 *
 * 分かる機会は「読めた」と「開けたのに転んだ（IdbTransactionError）」の2つで、どちらも
 * 保存を1回読んだ結果として現れる。読む場所ごとに記録すると必ずどこかで書き忘れ、
 * その経路だけが空へ退避して記録を分断する（実際、書き忘れを3回くり返した）。
 * 観測点はここしかないので、記録もここに置く。
 *
 * proves は「その保存が、この端末の IndexedDB かどうか」。退避先のメモリを読めても、
 * IndexedDB が使えることの証拠にはならない。
 */
async function loadOnce(store: Persistence, proves: boolean): Promise<unknown> {
	try {
		const raw = await store.load();
		if (proves) storageProven = true;
		return raw;
	} catch (e) {
		if (proves && e instanceof IdbTransactionError) storageProven = true;
		throw e;
	}
}

/** 保存から読む（openDb からやり直すので、閉じられた接続は次の回で開き直る）。 */
async function loadRaw(store: Persistence, proves: boolean): Promise<unknown> {
	let last: unknown;
	/** 「開けたのに転んだ」回。1回でもあれば、この端末で使えないとは言えない。 */
	let opened: IdbTransactionError | null = null;
	for (let i = 0; i < READ_ATTEMPTS; i += 1) {
		if (i > 0) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
		try {
			return await loadOnce(store, proves);
		} catch (e) {
			if (e instanceof IdbTransactionError) opened ??= e;
			last = e;
		}
	}
	// 最後の1回だけを見て決めない。1回目は開けたのに転び、2回目は開けもしなかった——
	// この並びで最後だけを返すと「この端末では IndexedDB が使えない」と読めてしまい、
	// 無事な記録を空で塗り替える。開けた回があるなら、そちらの事実を返す。
	throw last instanceof IdbTransactionError ? last : (opened ?? last);
}

/**
 * 空の保存への退避を差し戻せないか試す。
 *
 * 開けなかっただけの退避は、この端末で使えないと決めつけるには早い。退避先にまだ
 * 1件も書いていないうちなら、開き直せた時点で本物の中身に戻せて、何も失わない。
 * ここが無いと、起動時にたまたま開けなかっただけで、セッションの残り全部が
 * 「タブを閉じたら消える場所」になる。
 */
async function tryRecover(): Promise<ReadResult | null> {
	if (!recoverable() || !abandoned) return null;
	recoveryProbes += 1;
	const real = abandoned;
	let raw: unknown;
	try {
		raw = await loadOnce(real, true);
	} catch (e) {
		if (!(e instanceof IdbTransactionError)) return null; // まだ開けない。退避したまま続ける。
		// 開けた——「この端末では使えない」という見立てのほうが間違っていた（開けたことは
		// loadOnce が記録済み）。退避をやめて本物へ戻し、読めなかったことは失敗として返す。
		// ここで退避のまま書き続けると、元の記録は IndexedDB に、これから書く記録はメモリに、
		// と離ればなれになる（そしてタブを閉じた瞬間、あとから書いたほうだけが消える）。
		persistence = real;
		abandoned = null;
		memoryProvisional = false;
		storageUnavailable = false;
		// 退避先から読んだ写しは、もう手元に置かない（次は本物を読みにいく）。
		loaded = null;
		loading = null;
		throw e;
	}
	// 待っているあいだに退避先へ書かれていたら（memoryProvisional が降りる）、あるいは
	// 別の経路が先に差し戻していたら、ここで戻してはいけない——戻した先にその1件は無く、
	// たったいま残した記録だけが消える。列に並べたうえでの二重の守り。
	if (!memoryProvisional || abandoned !== real) return null;
	// 開けた。退避は無かったことにする。
	persistence = real;
	abandoned = null;
	memoryProvisional = false;
	storageUnavailable = false;
	return { db: raw === null || raw === undefined ? emptyDb() : normalizeDb(raw), store: real };
}

/**
 * 保存から読む。読めなかったときの扱いが2つに分かれる。
 *
 *   まだ一度も読めていない … その場かぎりの保存に切り替えて空で始める。この端末で
 *     IndexedDB が使えるかどうかがまだ分かっておらず、使えない端末（プライベート
 *     ブラウズ等）で画面を1枚も出せなくするよりはよい。ただし恒久ではなく、
 *     上の tryRecover で差し戻せるようにしておく。
 *
 *   一度でも読めた／開けはした … 一時的な障害とみなして、そのまま投げる。ここで空に
 *     切り替えると、無事な IndexedDB を尻目に「定義も記録もぜんぶ消えた」画面を出し、
 *     以後の書き込みはタブを閉じたら消える場所へ流れ続ける——読み込みが1回転んだだけで
 *     夏休みぶんの記録を捨てることになる。失敗は失敗のまま返して、次の機会に読み直す。
 */
async function readPersisted(serialized = false): Promise<ReadResult> {
	// 差し戻しは保存そのものを差し替えるので、書き込みと同じ列に並べる。
	// すでに列の中から呼ばれている（＝書き込みの読み直し）ときは、そのまま走らせる。
	const recovered = await (serialized || !recoverable() || !abandoned
		? tryRecover()
		: serialize(tryRecover));
	if (recovered) return recovered;

	const store = pickPersistence();
	try {
		// 退避先を読んでいるあいだの結果は、この端末の IndexedDB の証拠にはならない。
		const raw = await loadRaw(store, !storageUnavailable);
		return { db: raw === null || raw === undefined ? emptyDb() : normalizeDb(raw), store };
	} catch (e) {
		if (storageProven || e instanceof IdbTransactionError) throw e;
		abandoned = store; // 差し戻せるよう、あきらめた保存を覚えておく
		const fallback = fallbackToMemory(true);
		return { db: normalizeDb(await fallback.load()), store: fallback };
	}
}

/** いまの内容（初回だけ保存から読む）。 */
export function load(): Promise<Db> {
	// 通路は読む前に開けておく。書いたあとに開くと、開くまでのあいだに別のタブが
	// 書いた分を取りこぼし、そのまま古い写しを書き戻して相手の変更を消してしまう。
	ensureChannel();
	// 差し戻しを試せるあいだは、手元の空の写しを配らない。開き直せたらその場で
	// 本物の中身に戻る——ここで写しを配ると、退避したまま画面が空で固まる。
	if (loaded && !recoverable()) return Promise.resolve(loaded);
	if (!loading) {
		const attempt: Promise<Db> = readPersisted().then(({ db }) => {
			// 自分がまだ「いまの読み」なら採る。読んでいるあいだに mutate が新しい写しを
			// 入れていたり、別のタブの通知で捨てられていたりしたら、この写しはもう古い。
			// 入れると画面が巻き戻り、そこから作った次の書き込みが保存を上書きする。
			if (loading === attempt) {
				loaded = db;
				loading = null; // 次の読みは（差し戻せるなら）また保存を見にいく
			}
			return db;
		});
		// 失敗は覚え込まない。rejected のまま持ち続けると、以後の load() が全部その1回の
		// 失敗を返し、保存が生き返っても二度と読みにいかなくなる。
		attempt.catch(() => {
			if (loading === attempt) loading = null;
		});
		loading = attempt;
	}
	return loading;
}

export type MutateOptions = {
	/**
	 * 記録ではなく、この端末の事情だけを書く（通番を上げない＝催促に数えない）。
	 *
	 * 保存の持続を聞いた結果や、ホームの案内を閉じたこと。どれも保存には残すが、
	 * 「バックアップを取り直す理由」にはならない。内部の書き込みを足すときは、
	 * それが催促の「そのあと N件」に出てよい変更かどうかをここで決めること。
	 * 付け忘れても数えすぎるだけで、記録の変更が消えることはない（安全側に転ぶ）。
	 */
	local?: boolean;
};

/**
 * 書き込み。fn の中でドキュメントを書き換えると、通番を上げて保存し、他のタブに知らせる。
 *
 * 直列に実行されるので、fn の中では「読んで確かめてから書く」を安全に書ける
 * （楽観ロックの revision 比較がまさにそれ）。
 *
 * 書く直前に保存から読み直すのが要点。全体を1本のドキュメントとして書き戻す作りなので、
 * 手元の写しが古いまま保存すると、別のタブが入れた記録ごと消える。読み直しは
 * IndexedDB から数ミリ秒で、書き込みは人が押したときにしか起きないので、毎回やってよい。
 */
export function mutate<T>(fn: (db: Db) => T, options: MutateOptions = {}): Promise<T> {
	// 鍵の中で「読む」からやり直す。鍵を取るまでのあいだに別のタブが書いている
	// かもしれないので、鍵の外で読んだものを使ってはいけない。
	return serialize(async () => {
		ensureChannel();
		// 書き戻し先は「いま読んだ保存」。読んだところと書き戻すところが別になると、
		// その1件だけがどこからも読まれない場所に落ちる。
		const { db, store } = await readPersisted(true);
		loaded = db;
		loading = Promise.resolve(db);
		// 通番は fn を呼ぶ**前**に上げる。あとから上げると、fn の中で
		// 「この書き込みが終わったときの通番」を知る手段が無くなる。
		// 実際それでバックアップが自分の書き込みを数えてしまい、書き出した直後に
		// 「そのあと 1件」と出ていた。
		// 端末の事情だけを書く回は上げない（バックアップの催促に数えないため。model.ts の
		// meta.seq を参照）。通番を2本に分けるのではなく、この1本を上げるか上げないかで
		// 決める——分けると、新しいほうを知らない版が書いた記録が催促から消える。
		if (!options.local) db.meta.seq += 1;
		try {
			const result = fn(db);
			await store.save(db);
			// 退避先に書いたら、もう差し戻さない（差し戻すと、いま書いたものが消える）。
			memoryProvisional = false;
			channel?.postMessage({ seq: db.meta.seq });
			return result;
		} catch (e) {
			// 保存しなかったのに、手元の写しだけ通番が進んだ状態になっている。
			// 次に読むときに保存から取り直させる。
			loaded = null;
			loading = null;
			throw e;
		}
	});
}

/** 読み取り。書き込みの途中には割り込まない。 */
export const read = <T>(fn: (db: Db) => T): Promise<T> => load().then(fn);

/** 中身をまるごと入れ替える（バックアップからの復元）。
 *
 *  ふつうの書き込みと同じ列に並べる。`await chain` で待つだけだと、待ち終わった直後に
 *  始まった書き込みと並走してしまう——たとえばバックアップの状態を見にいったときに
 *  裏で走る「保存の持続を聞いた結果を覚える」書き込みと重なると、復元した中身が
 *  その1件で上書きされたり、逆にその1件が消えたりする。復元は「全部失った人が
 *  取り戻す」経路なので、いちばん割り込ませてはいけない。 */
export async function replaceAll(raw: unknown): Promise<void> {
	const next = normalizeDb(raw);
	await mutate((db) => {
		// mutate が既に1つ進めた通番。復元で戻すと、他のタブが「古い」と誤解する。
		const seq = db.meta.seq;
		// この端末の事情であって、記録ではないもの。バックアップの出どころの端末の
		// 値を持ち込むと、いちばん要る場面で守りが外れる:
		//   persisted           … 元の端末で許可済みだと、こちらでは保存の持続を頼まなくなる
		//   home_hint_dismissed … 元の端末で閉じてあると、ホーム画面に追加していない
		//                         こちらでも案内が出ない
		//   last_seen_day       … 日付の巻き戻り検知は、この端末の時計の話
		// バックアップは「端末を替えるときの引き継ぎ」として案内しているので、
		// ここは移行先の値を残す。
		//   storage_id         … この端末の保存が何代目か。出どころの端末の値を持ち込むと、
		//                        向こうで書き出したファイルがこちらの記録の続きに見える
		const local = {
			persisted: db.meta.persisted,
			home_hint_dismissed: db.meta.home_hint_dismissed,
			last_seen_day: db.meta.last_seen_day,
			storage_id: db.meta.storage_id
		};
		for (const key of Object.keys(db)) delete (db as Record<string, unknown>)[key];
		Object.assign(db, next);
		Object.assign(db.meta, local);
		db.meta.seq = Math.max(seq, next.meta.seq + 1);
		// 中身は「そのバックアップを取った時点」のもの。復元した直後に
		// 「そのあと N件」と出ないよう、いまの通番を基準にし直す。
		db.meta.last_backup_seq = db.meta.seq;
	});
}

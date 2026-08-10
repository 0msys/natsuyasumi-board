// 保存の実体。差し替えられるように interface を1枚だけ挟む。
//
// happy-dom には IndexedDB が無いので、ここを抜き差しできるようにしておくと、
// 保存層のロジック（採番・楽観ロック・履歴の切り詰め・改名）を追加の依存ゼロで
// bun test にかけられる。実機でしか確かめられないのは idb.ts の中だけになる。

/**
 * 書こうとしたら、先を越されていた（読んでから書き戻すまでに、別のタブが書いた）。
 *
 * 全体を1本のドキュメントとして書き戻す作りなので、そのまま書けば相手の1件が消える。
 * 書かずにこれを投げると、呼ぶ側（$lib/store/db の mutate）が読み直しからやり直す。
 * 失敗ではなく「やり直し」の合図なので、画面に出るところまで来ることはまず無い。
 */
export class StaleWriteError extends Error {
	constructor() {
		super('ほかの がめんが さきに かいたよ');
		this.name = 'StaleWriteError';
	}
}

export type Persistence = {
	load(): Promise<unknown | null>;
	/**
	 * 書き戻す。base は「書き換えのもとにした meta.seq」。
	 *
	 * 保存されているものがもう base ではなくなっていたら、**書かずに** StaleWriteError を
	 * 投げること（compare-and-set）。タブをまたぐ守りは本来 Web Locks だが、鍵が無い端末
	 * （Safari 15.4 より前）では鍵なしで進むので、そこでの最後の砦がこの突き合わせになる。
	 * 突き合わせは読みと同じトランザクションの中でやらないと意味が無い——読んでから
	 * 書くまでのあいだに割り込まれる隙が、防ぎたいものそのもの。
	 *
	 * 見分けられない組み合わせが1つだけ残る: 通番を上げない書き込み（db.ts の mutate の
	 * local）どうしがぶつかった回。通番が動かないので同じものに見える。そこで消えるのは
	 * その端末の事情（保存の持続を聞いた結果、案内を閉じたか）だけで、記録ではない。
	 */
	save(db: unknown, base: number): Promise<void>;
	/** ぜんぶ消す（バックアップからの復元で使う）。 */
	clear(): Promise<void>;
};

/** メモリだけの保存。テストと、IndexedDB が使えない環境の受け皿。 */
export function memoryPersistence(initial: unknown = null): Persistence {
	let current: unknown = initial;
	return {
		load: async () => current,
		// base は見ない。この保存はタブをまたがないので、割り込む相手がいない。
		save: async (db) => {
			current = JSON.parse(JSON.stringify(db));
		},
		clear: async () => {
			current = null;
		}
	};
}

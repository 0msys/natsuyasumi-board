// 保存の実体。差し替えられるように interface を1枚だけ挟む。
//
// happy-dom には IndexedDB が無いので、ここを抜き差しできるようにしておくと、
// 保存層のロジック（採番・楽観ロック・履歴の切り詰め・改名）を追加の依存ゼロで
// bun test にかけられる。実機でしか確かめられないのは idb.ts の中だけになる。
export type Persistence = {
	load(): Promise<unknown | null>;
	save(db: unknown): Promise<void>;
	/** ぜんぶ消す（バックアップからの復元で使う）。 */
	clear(): Promise<void>;
};

/** メモリだけの保存。テストと、IndexedDB が使えない環境の受け皿。 */
export function memoryPersistence(initial: unknown = null): Persistence {
	let current: unknown = initial;
	return {
		load: async () => current,
		save: async (db) => {
			current = JSON.parse(JSON.stringify(db));
		},
		clear: async () => {
			current = null;
		}
	};
}

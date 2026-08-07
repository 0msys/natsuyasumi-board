declare global {
	/** lite ビルド（NYB_TARGET=lite）かどうか。vite.config.ts の define で埋め込む。 */
	const __NYB_LITE__: boolean;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

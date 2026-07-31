/**
 * アウトメディア（テレビ等）視聴タイマーのクライアント・ストア（サーバ権威・複数端末で共有）.
 *
 * シングルトン（`export const` ＋ subscribe/set）。約5秒間隔で `GET /api/summer/media-timer/state` を
 * ポーリングして最新 state を配る＝別端末での start/pause を数秒で拾う（クロスデバイス反映）。
 * start()/pause() は confirm-before-update: サーバの戻り state で set する（楽観更新で乖離させない・
 * 失敗は lastError に載せて画面へ出す）。overlay の開閉フラグもここで持つ（+page が購読して描画）。
 *
 * lastError は「どの操作で失敗したか」の種別だけを持ち、日本語の文言は持たない。
 * 子どもに出す文言は学年で漢字の量が変わるので、描画側が ui から引く（生の例外は console へ）。
 */

import { api, type SummerMediaTimerState } from '$lib/api';

/** 失敗した操作の種別（画面の文言は $lib/summer/ui の timer_error_* から引く）. */
export type MediaTimerErrorKind = 'load' | 'start' | 'pause';

export type MediaTimerStoreState = {
	timer: SummerMediaTimerState | null;
	open: boolean; // 大きいオーバーレイを出しているか
	polling: boolean;
	lastError: MediaTimerErrorKind | null;
};

const POLL_INTERVAL_MS = 5_000;

class MediaTimerStore {
	private listeners = new Set<(s: MediaTimerStoreState) => void>();
	private _state: MediaTimerStoreState = { timer: null, open: false, polling: false, lastError: null };
	private pollHandle = 0;
	private ticking = false; // tick 多重起動防止（応答が遅れても並行実行しない）
	private child: string | null = null; // setup で受け取る対象の子（全 API 呼び出しに付ける）

	get state(): MediaTimerStoreState {
		return this._state;
	}

	subscribe(fn: (s: MediaTimerStoreState) => void): () => void {
		this.listeners.add(fn);
		fn(this._state);
		return () => this.listeners.delete(fn);
	}

	private emit() {
		for (const fn of this.listeners) fn(this._state);
	}

	private set(partial: Partial<MediaTimerStoreState>) {
		this._state = { ...this._state, ...partial };
		this.emit();
	}

	/** ページ mount 時・対象の子が変わったときに開始（冪等）。約5秒間隔でサーバ state を引く.
	 *
	 *  子を切り替えたら timer を捨てて即座に引き直す。切り替えは同じルート内の
	 *  クライアント遷移（/?child=… のリンク）なので、ここを素通りすると前の子の
	 *  経過時間と上限が最大5秒そのまま出る——上限は子どもごとなので「2時間の子の画面に
	 *  30分と出る」ことになり、操作先（新しい子）とも食い違う。
	 */
	setup(child: string) {
		const changed = this.child !== null && this.child !== child;
		this.child = child;
		if (changed) this.set({ timer: null, lastError: null });
		if (typeof window === 'undefined') return;
		if (this.pollHandle) {
			if (changed) void this.tick();
			return;
		}
		this.pollHandle = window.setInterval(() => void this.tick(), POLL_INTERVAL_MS);
		this.set({ polling: true });
		void this.tick(); // 初回は即座に1回
	}

	/** ページ unmount 時に停止（次の setup で再開できるよう handle をクリア）. */
	teardown() {
		if (this.pollHandle) {
			clearInterval(this.pollHandle);
			this.pollHandle = 0;
		}
		this.set({ polling: false });
	}

	/** 送信時の子と今の子が同じか（切り替えをまたいだ応答を捨てるため）.
	 *
	 *  子を切り替えた瞬間に前の子あての要求が飛んでいると、応答が後から届いて
	 *  新しい子の画面へ前の子の記録を書き戻してしまう（しかも操作は新しい子へ飛ぶ）。
	 */
	private stillCurrent(child: string): boolean {
		return this.child === child;
	}

	private async tick() {
		if (this.ticking || !this.child) return;
		// 非表示タブからは引かない.
		if (typeof document !== 'undefined' && document.hidden) return;
		const child = this.child;
		this.ticking = true;
		try {
			const timer = await api.summerMediaTimerState(child);
			if (this.stillCurrent(child)) this.set({ timer, lastError: null });
		} catch (e) {
			console.error('media-timer state', e);
			if (this.stillCurrent(child)) this.set({ lastError: 'load' });
		} finally {
			this.ticking = false;
		}
	}

	/** 見はじめた（スタート/さいかい）。confirm-before-update: サーバ戻り state で反映. */
	async start() {
		const child = this.child;
		if (!child) return;
		try {
			const timer = await api.summerMediaTimerStart(child);
			if (this.stillCurrent(child)) this.set({ timer, lastError: null });
		} catch (e) {
			console.error('media-timer start', e);
			if (this.stillCurrent(child)) this.set({ lastError: 'start' });
		}
	}

	/** やめた（ストップ＝一時停止）。confirm-before-update: サーバ戻り state で反映. */
	async pause() {
		const child = this.child;
		if (!child) return;
		try {
			const timer = await api.summerMediaTimerPause(child);
			if (this.stillCurrent(child)) this.set({ timer, lastError: null });
		} catch (e) {
			console.error('media-timer pause', e);
			if (this.stillCurrent(child)) this.set({ lastError: 'pause' });
		}
	}

	openOverlay() {
		this.set({ open: true });
	}

	closeOverlay() {
		this.set({ open: false });
	}
}

export const mediaTimerStore = new MediaTimerStore();

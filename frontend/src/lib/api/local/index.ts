// lite 版の api 実装（バックエンド無し。$lib/core で計算し $lib/store に保存する）。
//
// 中身は summer.ts（子どもページ）と admin.ts（管理画面）にある。ここは contract に
// 合わせて束ねるだけ。読み上げ（tts）は lite に持ち込まないと決めたので、ここで
// 確定した値を返して畳む。
import { ApiError, type Api } from '../contract';
import { adminApi } from './admin';
import { backupApi } from './backup';
import { summerApi } from './summer';

export const api: Api = {
	...summerApi,
	...adminApi,
	...backupApi,

	// ── 読み上げ: lite には無い ──
	// available:false は子どもページの既存の縮退経路に乗る（音声ボタンごと消える）。
	// supported:false は「VOICEVOX が落ちている」ではなく「この版に機能が無い」の意味で、
	// 管理画面の「こえ えらび」を丸ごと出さないために要る（出すと案内が嘘になる）。
	ttsStatus: async () => ({ available: false, speaker: 0 }),
	ttsSpeakers: async () => ({
		available: false,
		supported: false,
		speakers: [],
		default_speaker: 0
	}),
	ttsBlob: async () => {
		throw new ApiError(503, 'この版に よみあげは ありません', 'local');
	}
};

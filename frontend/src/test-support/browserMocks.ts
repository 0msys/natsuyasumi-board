// ブラウザ側の副作用（音声再生・効果音）を、テスト全体で1回だけ差し替える。
//
// apiMock.ts と同じ理由。bun の mock.module はプロセス全体に効くので、
// 各テストがばらばらに差し替えると実行順で壊れる。とくに $lib/summer/speakText のように
// 「別のテストが本物を検査しているモジュール」を差し替えるのは事故のもと
// （実際にそれで8件巻き添えにした）。差し替えるのは末端の副作用だけにして、
// speakText 自体は常に本物を通す＝どのテストからも同じ挙動に見えるようにする。
import { mock } from 'bun:test';

/** 再生された音声の src（新しい順ではなく呼ばれた順）. */
export const playedAudio: string[] = [];

mock.module('$lib/ttsAudio', () => ({
	getTtsAudio: () => ({
		pause() {},
		set src(value: string) {
			playedAudio.push(value);
		},
		onended: null,
		play: async () => {}
	}),
	unlockTtsAudio: () => {}
}));

// 効果音は Web Audio を触るので黙らせる（鳴ったかどうかを検査しているテストは無い）
mock.module('$lib/summer/sfx', () => ({
	unlockSummerSfx: () => {},
	playPop: () => {},
	playWhistle: () => {},
	playBoom: () => {},
	playFanfare: () => {},
	playTada: () => {}
}));

/** 各テストの beforeEach から呼ぶ（共有モジュールの afterEach は当てにしない。
 *  apiMock.ts の setApi の但し書きと同じ理由）. */
export function resetBrowserMocks(): void {
	playedAudio.length = 0;
}

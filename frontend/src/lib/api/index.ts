// api の単一窓口。どちらの実装が入るかは svelte.config.js の kit.alias（$apiImpl）が決める。
//
//   既定           → ./client.ts        （docker 版。/api を fetch する）
//   NYB_TARGET=lite → ./local/index.ts  （lite 版。ブラウザ内で計算・保存する）
//
// ApiError はここから再エクスポートしない。テストが $lib/api を丸ごと差し替える
// （src/test-support/apiMock.ts）ので、ここに値を足すとモック下で undefined になり
// `e instanceof ApiError` が TypeError で落ちる。ApiError は $lib/api/contract から取ること。
export { api } from '$apiImpl';
export type { Api, BackupStatus, BackupTicket } from './contract';
export type * from './types';

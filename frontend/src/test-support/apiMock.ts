// テスト用の $lib/api 差し替えを、この1か所に集約する。
//
// bun の mock.module はプロセス全体に効く。各テストがばらばらに「自分が使うぶんだけ」の
// 部分スタブで丸ごと差し替えると、あとから登録されたものが他のファイルにも効きうる
// ＝実行順で落ちる。実際にこの罠は一度踏んでいる（ページのテストが $lib/summer/speakText を
// 差し替え、本物を検査している speakText.test.ts を8件巻き添えにした）。
//
// 差し替えは1回だけ行い、テストは setApi() で自分の応答を差し込む。設定していない API を
// 呼ばれたら黙って undefined を返さずに落とす——「モックし忘れ」は、たいてい
// テストが想定と違う道を通っている合図なので、気づけるほうがよい。
import { mock } from 'bun:test';

type Handler = (...args: never[]) => unknown;

let handlers: Record<string, Handler> = {};

mock.module('$lib/api', () => ({
	api: new Proxy(
		{},
		{
			get(_target, name: string) {
				return (...args: never[]) => {
					const handler = handlers[name];
					if (!handler) {
						throw new Error(
							`テストで用意していない API 呼び出し: api.${name}()。` +
								'setApi({ ' +
								name +
								': ... }) を足すか、そこを通らない想定なら経路を見直すこと。'
						);
					}
					return handler(...args);
				};
			}
		}
	)
}));

/** このテストで使う API の応答を差し込む（毎回まるごと入れ替える）.
 *
 *  各テストの beforeEach から呼ぶこと。共有モジュール側で afterEach を張って白紙化する手も
 *  あるが、bun ではインポート元のファイルによって効いたり効かなかったりするので当てにしない
 *  （実際それで前のテストの状態が残り、検査が誤って通った）。 */
export function setApi(next: Record<string, Handler>): void {
	handlers = { ...next };
}

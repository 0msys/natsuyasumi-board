// 両ビルド共通の描画方針。
//
// ssr = false: サーバ側描画はしない。
//   lite（静的配信）には描画するサーバがそもそも無い。docker 版だけ SSR を残すと
//   +page.ts の load が2系統に分かれ（SSR は event.fetch、lite は api.*）、
//   「docker では通るが lite では落ちる」という食い違いを作る。実際 api.* は相対 URL を
//   グローバル fetch に渡すので、Node 側で走らせると URL のパースで落ちる。
//   失うのは初回ペイントの本文だけで、この画面はどちらも元から JS 必須
//   （リアクティブ編集・60秒ポーリング・タイマー）。
//
// prerender: lite のときだけ。静的な入れ物（シェル）をビルド時に書き出す。
//   ssr=false なので load は走らず、API を叩きにいくこともない。
//   これで /・/admin・/admin/new・/manual が実ファイルになり、GitHub Pages でも 200 で返る。
//   子ども名が入る /admin/[child] だけは列挙できないので prerender=false にして
//   404.html フォールバック（adapter-static の fallback）に任せる。
//
//   docker 版では prerender しない。adapter-node は書き出したファイルを handle より先に
//   静的配信するので、prerender すると src/hooks.server.ts が付けている
//   X-Frame-Options / X-Content-Type-Options / Referrer-Policy がそのページだけ落ちる
//   （実際に /admin で3本とも消えることを確認した）。
export const ssr = false;
export const prerender = __NYB_LITE__;

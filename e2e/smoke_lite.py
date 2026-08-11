"""lite 版（バックエンド無し・ブラウザ保存）の通しスモーク。

    cd frontend && bun run build:lite
    cd frontend && bun run preview:lite &
    BASE=http://127.0.0.1:4173/natsuyasumi-board uv run --with playwright python e2e/smoke_lite.py

確かめること:
  ① 定義がゼロなら初回ウィザードへ行く（サブパス配信でもリンクが壊れていない）
  ② ウィザードで登録できて、日本語の子ども名を含む動的ルートが開ける
  ③ 子どもページで「やった」を押すと点数が動く
  ④ リロードしても記録が残る＝IndexedDB に本当に書けている
  ⑤ 管理画面まで行ける
  ⑥ 読み上げの欄が出ていない（lite には機能が無いので、出ると案内が嘘になる）
  ⑦ バックアップを取って、手元にあると答えて、消して、戻せる（＝消えても取り返せる）
  ⑧ Service Worker が入り、圏外でも各ページが開ける（ホーム画面に追加した先での想定）
  ⑨ 保存が使えない端末（プライベートブラウズ相当）では、設定を入れる前に警告が出る
  ⑩ 要るものが揃わないときは Service Worker を入れない（古いキャッシュを消さない）
  ⑪ マニュアルが開き、版の切り替えが lite を選んだ状態で始まる
     （__NYB_LITE__ は vite の define なので bun test では検証できない。ここが唯一の番人）

docker 版の smoke_child_page.py と対になる。あちらはサーバ権威の往復を見るが、
こちらは「サーバが無くても同じことができる」を見る。
"""

import asyncio
import os
import re
import sys
from urllib.parse import quote

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:4173/natsuyasumi-board").rstrip("/")
CHILD = os.environ.get("CHILD", "はな")
SHOT = os.environ.get("SHOT", "smoke_lite.png")


def score_of(text: str) -> int | None:
    """画面の「きょうのがんばり」の点数を拾う（見つからなければ None）."""
    m = re.search(r"(\d+)\s*点", text)
    return int(m.group(1)) if m else None


async def main() -> int:
    problems: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # バックアップの書き出しを受け取るので、ダウンロードを許可する
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()
        # 取り込みの確認ダイアログは「はい」で進める
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        page.on(
            "console",
            lambda m: problems.append(f"console.{m.type}: {m.text}") if m.type == "error" else None,
        )
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        page.on(
            "response",
            lambda r: problems.append(f"{r.status} {r.url}") if r.status >= 400 else None,
        )

        # ① 入口
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_timeout(400)
        if "/admin/new" not in page.url:
            problems.append(f"① 定義ゼロならウィザードへ行くはずが {page.url}")

        # ② ウィザード（名前 → 学年 → 期間 → テンプレート）
        await page.locator('input[type="text"]').first.fill(CHILD)
        await page.get_by_role("button", name="つぎへ").click()
        await page.get_by_role("button", name="小2", exact=True).click()
        await page.get_by_role("button", name="つぎへ").click()
        # 「今日」が期間に入っていないとチェックが押せないので、今日をまたぐ期間にする
        today = await page.evaluate(
            "new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date())"
        )
        year = int(today[:4])
        dates = page.locator('input[type="date"]')
        await dates.nth(0).fill(f"{year}-07-01")
        await dates.nth(1).fill(f"{year}-12-30")
        await dates.nth(2).fill(f"{year}-12-31")
        await page.get_by_role("button", name="つぎへ").click()
        await page.get_by_role("button", name="標準ではじめる").first.click()
        await page.get_by_role("button", name="この内容でつくる").click()
        await page.wait_for_timeout(800)
        if "/admin/" not in page.url or page.url.endswith("/new"):
            problems.append(f"② 登録後は編集画面へ行くはずが {page.url}")

        # ③ 子どもページでチェック
        await page.goto(f"{BASE}/", wait_until="networkidle")
        await page.wait_for_timeout(600)
        before = score_of(await page.inner_text("body"))
        yatta = page.get_by_role("button", name="やった").first
        if await yatta.count() == 0:
            problems.append("③ 「やった」ボタンが見つからない")
        else:
            await yatta.click()
            await page.wait_for_timeout(800)
            after = score_of(await page.inner_text("body"))
            if before is not None and after is not None and after <= before:
                problems.append(f"③ チェックしても点が増えない（{before} → {after}）")

        # ④ リロードしても残るか
        recorded = await page.inner_text("body")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(800)
        reloaded = await page.inner_text("body")
        if score_of(recorded) != score_of(reloaded):
            problems.append(
                f"④ リロードで記録が消えた（{score_of(recorded)} → {score_of(reloaded)}）"
            )
        if CHILD not in reloaded:
            problems.append("④ リロード後に子どもページが出ていない")

        # ⑤⑥ 管理画面
        await page.goto(f"{BASE}/admin", wait_until="networkidle")
        await page.wait_for_timeout(400)
        admin = await page.inner_text("body")
        if CHILD not in admin:
            problems.append("⑤ 管理画面に子どもが出ていない")
        if "よみあげの こえ" in admin:
            problems.append("⑥ lite に無いはずの読み上げの欄が出ている")

        # ⑦ バックアップの往復（取る → 手元にあると答える → 消す → 戻す）
        async with page.expect_download() as dl_info:
            await page.get_by_role("button", name="バックアップする").click()
        download = await dl_info.value
        backup_path = await download.path()
        if backup_path is None:
            problems.append("⑦ バックアップのファイルを受け取れなかった")
        else:
            # 押しただけでは「バックアップした」ことにならない（届いたかは分からないので、
            # ここで刻むと共有シートを閉じただけの人も催促から外れる）。
            # 見るのは画面ではなく保存のほう——書き込んでいても画面を据え置く作りだと、
            # その場の表示では気づけない。いちど読み直してから確かめる。
            await page.reload(wait_until="networkidle")
            await page.wait_for_timeout(600)
            if "さいごのバックアップ" in await page.inner_text("body"):
                problems.append("⑦ 確かめる前に「さいごのバックアップ」が記録されている")

            # 読み直したので問いかけは消えている。もう一度出して、今度は手元にあると答える。
            async with page.expect_download():
                await page.get_by_role("button", name="バックアップする").click()
            # 出ていないなら待たずに報告する（30秒待って落ちるより、何が起きたか読める）
            confirm = page.get_by_role("button", name="ほぞんできた")
            if await confirm.count() == 0:
                problems.append("⑦ 「ほぞんできた」の確認が出ていない")
            else:
                await confirm.click()
                await page.wait_for_timeout(400)
                if "さいごのバックアップ: きょう" not in await page.inner_text("body"):
                    problems.append("⑦ 「ほぞんできた」を押しても記録されていない")

            # 子どもごと消してから、バックアップで戻す
            await page.get_by_role("button", name="削除", exact=False).first.click()
            await page.wait_for_timeout(300)
            # 削除は名前を打たせる確認モーダル
            await page.locator('input[type="text"]').last.fill(CHILD)
            await page.get_by_role("button", name="けす").click()
            await page.wait_for_timeout(600)
            if CHILD in await page.inner_text("body"):
                problems.append("⑦ 削除したのに一覧に残っている")

            # 「もどす」が開くファイル選択に渡す（画面には取り込み口が2つあるので、
            # locator で当てにいかずボタンから辿る）
            async with page.expect_file_chooser() as fc_info:
                await page.get_by_role("button", name="もどす").click()
            chooser = await fc_info.value
            await chooser.set_files(str(backup_path))
            await page.wait_for_timeout(1200)
            restored = await page.inner_text("body")
            if CHILD not in restored:
                problems.append("⑦ バックアップから戻せなかった")

        # ⑪ マニュアル。既定タブが lite であることを見る＝ vite の define が
        #    typeof のガードを通り抜けて畳まれている、ということ。bun test には define が
        #    無いので「docker 側」しか確かめられず、lite 側はここでしか押さえられない。
        await page.goto(f"{BASE}/manual", wait_until="networkidle")
        await page.wait_for_timeout(400)
        if not await page.locator('input[name="manual-edition"][value="lite"]').is_checked():
            problems.append("⑪ マニュアルの既定タブが lite になっていない")
        manual_text = await page.inner_text("body")
        if "ほぞんできた" not in manual_text:
            problems.append("⑪ lite だけの説明（バックアップ手順）が出ていない")
        if "VOICEVOX" in manual_text:
            problems.append("⑪ lite なのに docker だけの説明（VOICEVOX）が出ている")

        # ⑧ 圏外でも開けるか（Service Worker が入っていること自体の確認でもある）
        await page.goto(f"{BASE}/", wait_until="networkidle")
        try:
            await page.evaluate("navigator.serviceWorker.ready")
        except Exception:
            problems.append("⑧ Service Worker が有効にならなかった")
        await page.wait_for_timeout(1500)
        await context.set_offline(True)
        for path in ["/", "/admin", "/admin/new", "/manual", f"/admin/{quote(CHILD)}"]:
            try:
                await page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=10000)
                await page.wait_for_timeout(600)
                if not (await page.inner_text("body")).strip():
                    problems.append(f"⑧ 圏外で {path} が空っぽ")
            except Exception:
                problems.append(f"⑧ 圏外で {path} が開けなかった")
        await context.set_offline(False)

        await page.screenshot(path=SHOT, full_page=True)

        # ⑨ 保存が使えない端末での警告。定義がゼロだと入口はウィザードへ直行し、
        #    登録が終わると編集画面へ移るので、一覧を一度も通らずに設定を終えられる。
        #    そこに警告が出ないと、閉じた瞬間に全部消えたことにあとから気づくことになる。
        warn = "この画面では記録が保存されません"
        broken = await browser.new_context()
        await broken.add_init_script(
            "indexedDB.open = function () { throw new DOMException('denied', 'SecurityError'); };"
        )
        bp = await broken.new_page()
        await bp.goto(f"{BASE}/", wait_until="networkidle")
        await bp.wait_for_timeout(1200)
        if warn not in await bp.inner_text("body"):
            problems.append(f"⑨ ウィザード（{bp.url}）に警告が出ていない")
        await broken.close()

        # 保存できる端末では出しっぱなしにしない
        if warn in await page.inner_text("body"):
            problems.append("⑨ 保存できる端末なのに警告が出ている")

        # ⑩ 要るもの（JS）が欠けたら Service Worker を入れない。
        #    中途半端に入ると、次の activate が「完全だった古いキャッシュ」を消してしまい、
        #    圏外で入れ物だけ返って中身が読めない、という前より悪い状態になる。
        #    ここは addAll と allSettled のあいだで2回ひっくり返っているので固定しておく。
        broken_sw = await browser.new_context()
        await broken_sw.route("**/_app/immutable/chunks/*", lambda route: route.abort())
        bsp = await broken_sw.new_page()
        try:
            await bsp.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=15000)
        except Exception:
            pass  # JS が読めないので描画は失敗してよい。見たいのは登録の有無だけ
        await bsp.wait_for_timeout(2500)
        n = await bsp.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
        if n != 0:
            problems.append("⑩ 要るものが揃っていないのに Service Worker が入っている")
        await broken_sw.close()

        await browser.close()

    if problems:
        print("だめだったところ:")
        for p_ in problems:
            print("  -", p_)
        return 1
    print(f"ぜんぶ通った（スクリーンショット: {SHOT}）")
    return 0


sys.exit(asyncio.run(main()))

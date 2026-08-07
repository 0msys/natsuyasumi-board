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
  ⑦ バックアップを取って、消して、戻せる（＝消えても取り返せる）

docker 版の smoke_child_page.py と対になる。あちらはサーバ権威の往復を見るが、
こちらは「サーバが無くても同じことができる」を見る。
"""

import asyncio
import os
import re
import sys

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

        # ⑦ バックアップの往復（取る → 消す → 戻す）
        async with page.expect_download() as dl_info:
            await page.get_by_role("button", name="バックアップする").click()
        download = await dl_info.value
        backup_path = await download.path()
        if backup_path is None:
            problems.append("⑦ バックアップのファイルを受け取れなかった")
        else:
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

        await page.screenshot(path=SHOT, full_page=True)
        await browser.close()

    if problems:
        print("だめだったところ:")
        for p_ in problems:
            print("  -", p_)
        return 1
    print(f"ぜんぶ通った（スクリーンショット: {SHOT}）")
    return 0


sys.exit(asyncio.run(main()))

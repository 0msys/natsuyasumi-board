# 子どもページのスモーク E2E（実ブラウザ・Playwright）。
#
# 前提: バックエンドとフロントが起動済みで、子どもが1人以上登録済みであること。
#   BASE=http://127.0.0.1:8082 CHILD=はな uv run --with playwright python e2e/smoke_child_page.py
# （初回は `uv run --with playwright playwright install chromium` が必要）
#
# 確認すること:
#  1. 主要カード（きょうのチェック・きょうのがんばり）が描画され、コンソールエラーが無い
#  2. 「やった」ボタン → サーバ往復 → スコアが変わる（confirm-before-update の実往復）
#  3. 履歴グリッドの過去日タップ → 修正モーダルが開く
#  4. マニュアルが開き、版の切り替えが docker を選んだ状態で始まる
#     （lite 側は smoke_lite.py の⑪。__NYB_LITE__ は vite の define なので bun test では見えない）
#
# 注意: vite dev 相手では HMR WebSocket があるため networkidle を使わない。
#       クリックはハイドレーション前だと無効 → スコア変化を待って必要なら再クリック。
import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:8082")
OUT = os.environ.get("E2E_OUT", ".")


async def main() -> int:
    errors: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None,
        )

        await page.goto(BASE + "/", wait_until="domcontentloaded")
        await page.wait_for_selector("text=きょうのチェック", timeout=15000)
        for text in ("きょうのがんばり", "なつやすみ"):
            assert await page.get_by_text(text, exact=False).count(), f"not visible: {text}"

        score_el = page.locator("section:has-text('きょうのがんばり') span.text-4xl").first
        before = (await score_el.inner_text()).strip()

        btn = page.locator("section:has-text('きょうのチェック') button[aria-label='やった']").first
        after = before
        for _ in range(5):
            await btn.click()
            try:
                await page.wait_for_function(
                    "(prev) => [...document.querySelectorAll('span')]"
                    ".some(s => s.classList.contains('text-4xl') && s.textContent.trim() !== prev)",
                    arg=before,
                    timeout=3000,
                )
                after = (await score_el.inner_text()).strip()
                break
            except Exception:
                continue
        print(f"score: {before} -> {after}")

        # 履歴グリッドの過去日セル（title=ISO日付のボタン）→ 修正モーダル
        opened = False
        for cell in await page.locator("button[title^='20']").all():
            title = await cell.get_attribute("title")
            await cell.scroll_into_view_if_needed()
            await cell.click()
            await page.wait_for_timeout(600)
            if await page.locator("[role=dialog], .fixed.inset-0").count():
                opened = True
                print(f"day-edit modal opened: {title}")
                await page.keyboard.press("Escape")
                break
        await page.screenshot(path=f"{OUT}/smoke_child_page.png", full_page=True)

        # マニュアル。既定タブが docker であること＝ define が畳まれていること。
        manual_ok = False
        await page.goto(BASE + "/manual", wait_until="domcontentloaded")
        await page.wait_for_selector("text=つかいかた", timeout=15000)
        checked = await page.locator("input[name='manual-edition'][value='docker']").is_checked()
        body = await page.inner_text("body")
        manual_ok = checked and "VOICEVOX" in body and "ほぞんできた" not in body
        print("manual default edition = docker:", manual_ok)

        await browser.close()

    print("console/page errors:", errors if errors else "none")
    ok = (before != after) and opened and manual_ok and not errors
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


sys.exit(asyncio.run(main()))

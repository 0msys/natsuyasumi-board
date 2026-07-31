"""FastAPI アプリファクトリ（最小構成）。

/api は同一オリジン（フロントの hooks.server.ts / vite proxy が中継）で使う前提のため
CORS ミドルウェアは載せない。認証は無し（家庭内 LAN 専用。README のセキュリティ注意を参照。
管理 API のみ任意の ADMIN_PIN ゲートあり）。
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from app.db import ensure_schema
from app.routers import admin, summer, tts


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_schema()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="natsuyasumi-board", lifespan=lifespan)
    # /api/summer/state は履歴45日ぶん＋画面文言でおよそ 23KB あり、gzip なら 4.5KB になる。
    # ただし通常経路では効かない：フロントの hooks.server.ts が上流へ
    # accept-encoding: identity を送る（fetch が透過解凍する一方 Content-Encoding は残るため、
    # 圧縮上流だとブラウザが二重解凍で壊れる）。効くのはバックエンドを直接叩いたときだけ。
    # ブラウザまで圧縮を届けたければ SvelteKit 側で圧縮する必要があるが、家庭内 LAN の
    # 60秒ポーリング（実測 23KB）では割に合わないので今はやらない。
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.include_router(summer.router)
    app.include_router(tts.router)
    app.include_router(admin.router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()

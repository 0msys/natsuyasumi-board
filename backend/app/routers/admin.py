"""管理画面のエンドポイント（/api/admin/*）.

  POST /api/admin/login                        ADMIN_PIN 照合 → HttpOnly クッキー発行
  GET  /api/admin/session                      PIN が必要か・ログイン済みか
  GET  /api/admin/definitions                  定義一覧（子どもごとに最新年）
  POST /api/admin/definitions                  ウィザード新規作成（テンプレートから）
  GET/PUT /api/admin/definitions/{child}       編集用ドキュメント取得 / 全文置換保存（楽観ロック）
                                               ?year= で年を選ぶ（省略時はいま画面に出ている年）
  POST /api/admin/definitions/{child}/next-year  前年からコピーして来年ぶんを作る
  POST /api/admin/definitions/{child}/validate ドライラン検証（常に 200・issue リスト）
  POST /api/admin/definitions/{child}/rename   子ども名の変更（記録も一括更新）
  DELETE /api/admin/definitions/{child}        定義の削除（記録は残る）
  GET  /api/admin/definitions/{child}/usage    item_key → 記録件数（削除警告用）
  GET  /api/admin/definitions/{child}/export   定義 JSON のダウンロード（共有・バックアップ）
  POST /api/admin/definitions/{child}/purge-orphans  定義に無いキーの記録を物理削除（明示操作）
  POST /api/admin/definitions/import           定義 JSON のアップロード → 新規作成
  GET  /api/admin/kanji                        学年別配当漢字（フロントのライブ lint 用）

PIN ゲート（auth.require_admin）は login/session 以外の全エンドポイントに掛かる。
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.admin import auth, definition_store, template, validate
from app.admin.definition_store import DefinitionStoreError
from app.summer import definition as summer_definition
from app.summer import kanji, service

router = APIRouter()


class LoginIn(BaseModel):
    pin: str


@router.post("/api/admin/login")
async def admin_login(body: LoginIn, request: Request, response: Response) -> dict:
    """PIN を照合してセッションクッキーを発行する（PIN はボディのみ・ログに残さない）.

    誤 PIN のバックオフ（auth.login）は asyncio ベースのため、遅延中もワーカースレッドや
    イベントループを塞がない。スロットルは端末ごとなので、誤 PIN の連投で別の端末の
    正規ログインが妨げられることはない。
    """
    token = await auth.login(body.pin, auth.client_key(request))
    response.set_cookie(
        auth.COOKIE_NAME, token, httponly=True, samesite="lax", max_age=30 * 24 * 3600
    )
    return {"ok": True}


@router.get("/api/admin/session")
def admin_session(request: Request) -> dict:
    """PIN が必要か・いま管理 API にアクセスできるかを返す（フロントが PIN パッドを出す判断に使う）.

    ADMIN_PIN 未設定でも ADMIN_NO_AUTH の明示オプトインが無ければ authenticated=False
    （フェイルクローズ）になる。実際のゲート（require_admin）と同じ判定を用いる。

    このとき pin_required も False なので、2つのフラグだけでは「PIN を入れれば入れる」状態と
    区別がつかず、フロントが管理 UI を出してしまい保存時にだけ 403 になる。第3の状態として
    admin_disabled を返し、PIN パッドではなく設定方法の案内を出せるようにする。
    """
    try:
        auth.require_admin(request)
        authenticated = True
    except HTTPException:
        authenticated = False
    return {
        "pin_required": auth.pin_required(),
        "authenticated": authenticated,
        "admin_disabled": not auth.pin_required() and not auth.no_auth_mode(),
    }


@router.get("/api/admin/definitions", dependencies=[Depends(auth.require_admin)])
def admin_list_definitions() -> dict:
    return {"definitions": summer_definition.list_children()}


class CreateIn(BaseModel):
    child: str
    child_kana: str = ""
    grade: str  # 小1〜小6
    year: int
    period: dict  # {start, end, first_day_of_school}（YYYY-MM-DD）
    template: str = "standard"  # 'standard' | 'empty'


@router.post("/api/admin/definitions", dependencies=[Depends(auth.require_admin)])
def admin_create_definition(body: CreateIn) -> dict:
    builder = template.TEMPLATES.get(body.template)
    if builder is None:
        raise HTTPException(status_code=400, detail=f"しらないテンプレートです: {body.template}")
    doc = builder(
        body.child.strip(), body.child_kana.strip() or body.child.strip(), body.grade, body.year, body.period
    )
    try:
        return definition_store.create_definition(doc)
    except DefinitionStoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None


@router.get("/api/admin/definitions/{child}", dependencies=[Depends(auth.require_admin)])
def admin_get_definition(child: str, year: int | None = None) -> dict:
    """編集用ドキュメント（year 省略時はいま子ども画面に出ている年）."""
    entry = definition_store.get_document(child, year=year)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"「{child}」の定義がありません")
    return entry


class SaveIn(BaseModel):
    doc: dict
    revision: int  # 楽観ロック（GET で受け取った値。不一致は 409）


@router.put("/api/admin/definitions/{child}", dependencies=[Depends(auth.require_admin)])
def admin_save_definition(child: str, body: SaveIn, year: int | None = None) -> dict:
    try:
        return definition_store.save_document(child, body.doc, body.revision, year=year)
    except DefinitionStoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None


@router.post("/api/admin/definitions/{child}/next-year", dependencies=[Depends(auth.require_admin)])
def admin_create_next_year(child: str) -> dict:
    """いちばん新しい年の定義から翌年ぶんを作る（項目はそのまま・記録は引き継がない）."""
    try:
        return definition_store.create_next_year(child)
    except DefinitionStoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None


class ValidateIn(BaseModel):
    doc: dict


def _doc_year(doc: dict) -> int | None:
    """検証中のドキュメントの年（数字でなければ None＝年で絞らない）."""
    year = doc.get("year") if isinstance(doc, dict) else None
    return year if isinstance(year, int) and not isinstance(year, bool) else None


@router.post("/api/admin/definitions/{child}/validate", dependencies=[Depends(auth.require_admin)])
def admin_validate_definition(child: str, body: ValidateIn) -> dict:
    """ドライラン検証（保存しない・常に 200 で issue リストを返す）.

    比較相手（prev_doc）と記録の範囲は「編集中のドキュメントと同じ年」で取る。
    年をまたいで持っている子で、去年の定義や記録と比べて警告を出さないため。
    """
    year = _doc_year(body.doc)
    prev = definition_store.get_document(child, year=year)
    return validate.validate_document(
        body.doc,
        prev_doc=prev["doc"] if prev else None,
        usage=definition_store.usage(child),
        record_days=definition_store.record_day_range(child, year=year),
        today=service.today_jst(),
    )


class RenameIn(BaseModel):
    new: str


@router.post("/api/admin/definitions/{child}/rename", dependencies=[Depends(auth.require_admin)])
def admin_rename_child(child: str, body: RenameIn) -> dict:
    try:
        definition_store.rename_child(child, body.new)
    except DefinitionStoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    return {"ok": True, "child": body.new.strip()}


@router.delete("/api/admin/definitions/{child}", dependencies=[Depends(auth.require_admin)])
def admin_delete_definition(child: str, year: int | None = None) -> dict:
    """定義を削除する（year 指定でその年だけ・省略でその子の全年）."""
    if definition_store.get_document(child, year=year) is None:
        raise HTTPException(status_code=404, detail=f"「{child}」の定義がありません")
    definition_store.delete_definition(child, year=year)
    return {"ok": True}


@router.get("/api/admin/definitions/{child}/usage", dependencies=[Depends(auth.require_admin)])
def admin_usage(child: str) -> dict:
    return {"usage": definition_store.usage(child)}


@router.get("/api/admin/definitions/{child}/export", dependencies=[Depends(auth.require_admin)])
def admin_export(child: str, year: int | None = None) -> Response:
    """定義 JSON をダウンロードさせる（家庭間の共有・手元バックアップ用）."""
    entry = definition_store.get_document(child, year=year)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"「{child}」の定義がありません")
    body = json.dumps(entry["doc"], ensure_ascii=False, indent=2)
    filename = f"{entry['year']}-{child}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote(filename)}"},
    )


def _quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


class ImportIn(BaseModel):
    doc: dict


@router.post("/api/admin/definitions/import", dependencies=[Depends(auth.require_admin)])
def admin_import(body: ImportIn) -> dict:
    """エクスポートした定義 JSON から新規作成する（同じ子の同じ年が既に居れば 409）."""
    try:
        return definition_store.create_definition(body.doc)
    except DefinitionStoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None


@router.post("/api/admin/definitions/{child}/purge-orphans", dependencies=[Depends(auth.require_admin)])
def admin_purge_orphans(child: str) -> dict:
    """定義に存在しない item_key の記録を物理削除する（確認 UI からの明示操作のみ）."""
    try:
        return definition_store.purge_orphans(child)
    except summer_definition.SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None


@router.get("/api/admin/kanji", dependencies=[Depends(auth.require_admin)])
def admin_kanji() -> dict:
    """学年別配当漢字（学年→文字列）。フロントはこれで入力中のライブ lint を行う."""
    return {"grades": {str(g): "".join(sorted(chars)) for g, chars in kanji.GRADE_KANJI.items()}}

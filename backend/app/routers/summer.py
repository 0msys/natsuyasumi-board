"""子ども向けページのエンドポイント.

  GET  /api/summer/children      登録されている子どもの一覧（フロントの子ども選択）
  GET  /api/summer/state         画面状態の一括取得（チェック・履歴・採点・褒めメッセージ・やること）
  POST /api/summer/check/set     日次3値記録（done/not_done/null=未記入へ戻す。過去日可・未来日は 400）
  POST /api/summer/check/meta    日次項目のメモ（本のだいめい・計算タイム等）を保存（done の日のみ）
  POST /api/summer/flag/toggle   一回もの宿題・新学期じゅんび・選択肢の完了トグル（skip 項目は 400）
  POST /api/summer/count/set     カウント型（読書冊数）の値設定
  POST /api/summer/decision/set  任意宿題・選択肢の やる/やらない（全部「やらない」は 400）
  GET  /api/summer/todo-speech   「きょうやること」読み上げテキスト（合成はフロントが /api/tts で行う）
  GET/POST /api/summer/media-timer/{state,start,pause}  アウトメディア視聴タイマー

定義の単一真実源は DB の summer_definitions（app/summer/definition.py が検証）、
記録は summer_*（app/summer/store.py・DDL は schema.sql）。child は全エンドポイント必須。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.summer import definition as summer_definition
from app.summer import service
from app.summer.definition import SummerDefinitionError
from app.summer.service import SummerWriteError

router = APIRouter()


@router.get("/api/summer/children")
def summer_children() -> dict:
    """登録されている子どもの一覧（最新年の定義・壊れた定義は valid=False で返す）."""
    return {"children": summer_definition.list_children()}


@router.get("/api/summer/state")
def summer_state(child: str) -> dict:
    """画面の表示状態を一括で返す（定義が壊れていれば 503）."""
    try:
        return service.build_state(child)
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None


class CheckSetIn(BaseModel):
    child: str
    day: str  # "YYYY-MM-DD"
    item_key: str
    status: str | None  # 'done' / 'not_done' / 'cancelled'(cancelable項目のみ) / None=未記入へ戻す


class CheckSetOut(BaseModel):
    status: str | None


@router.post("/api/summer/check/set")
def summer_check_set(body: CheckSetIn) -> CheckSetOut:
    """日次3値記録を書く（過去日の修正は許可・未来日と期間外は 400）."""
    try:
        status = service.set_check(body.child, body.day, body.item_key, body.status)
    except SummerWriteError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    return CheckSetOut(status=status)


class CheckMetaIn(BaseModel):
    child: str
    day: str  # "YYYY-MM-DD"
    item_key: str
    meta: dict  # 更新する { field_key: 値 }（空値でそのフィールドを消す）


class CheckMetaOut(BaseModel):
    meta: dict


@router.post("/api/summer/check/meta")
def summer_check_meta_set(body: CheckMetaIn) -> CheckMetaOut:
    """日次項目のメモ（本のだいめい・計算タイム等）を保存する（「やった」の日のみ・過去日可）."""
    try:
        merged = service.set_meta(body.child, body.day, body.item_key, body.meta)
    except SummerWriteError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    return CheckMetaOut(meta=merged)


class FlagToggleIn(BaseModel):
    child: str
    item_key: str


class FlagToggleOut(BaseModel):
    value: int
    done: bool


@router.post("/api/summer/flag/toggle")
def summer_flag_toggle(body: FlagToggleIn) -> FlagToggleOut:
    """フラグ型項目（一回もの宿題・じゅんび・選択肢）の完了トグル."""
    try:
        result = service.toggle_flag(body.child, body.item_key)
    except SummerWriteError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    return FlagToggleOut(**result)


class CountSetIn(BaseModel):
    child: str
    item_key: str
    value: int


@router.post("/api/summer/count/set")
def summer_count_set(body: CountSetIn) -> FlagToggleOut:
    """カウント型項目（読書冊数）の値を設定する（0〜99 にクランプ）."""
    try:
        result = service.set_count(body.child, body.item_key, body.value)
    except SummerWriteError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    return FlagToggleOut(**result)


class DecisionSetIn(BaseModel):
    child: str
    item_key: str
    decision: str | None  # 'do' / 'skip' / None=未定へ戻す


class DecisionSetOut(BaseModel):
    decision: str | None


@router.post("/api/summer/decision/set")
def summer_decision_set(body: DecisionSetIn) -> DecisionSetOut:
    """やる/やらないの意思決定（選択宿題で全部「やらない」になる skip は 400）."""
    try:
        result = service.set_decision(body.child, body.item_key, body.decision)
    except SummerWriteError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    return DecisionSetOut(**result)


@router.get("/api/summer/todo-speech")
def summer_todo_speech(child: str) -> dict:
    """「きょうやること」読み上げテキスト（決定的・LLM 不使用。音声合成はフロントが /api/tts）."""
    try:
        return service.build_todo_speech(child)
    except SummerDefinitionError as e:
        raise HTTPException(status_code=503, detail=str(e)) from None


class MediaTimerIn(BaseModel):
    child: str


class MediaTimerOut(BaseModel):
    child: str
    day: str  # "YYYY-MM-DD"（JST・毎日0から）
    running: bool
    resumed_at: int | None  # running=1 区間の開始 epoch秒（停止中は None）
    accumulated_seconds: int
    elapsed_seconds: int  # accumulated + 走行中区間。server_now 基準でクライアントが補間する
    server_now: int  # サーバの現在 epoch秒（端末時計のズレを吸収するための基準）
    limit_seconds: int  # その子の上限（定義の media_timer.limit_minutes・既定2時間＝7200）
    limit_label: str  # 上限の表示文字列（学年で開いたルビ記法。例「2時間《じかん》」）
    over_limit: bool


@router.get("/api/summer/media-timer/state")
def summer_media_timer_state(child: str) -> MediaTimerOut:
    """アウトメディア視聴タイマーの現在 state（今日・JST）を返す（採点とは独立）."""
    return MediaTimerOut(**service.media_timer_state(child))


@router.post("/api/summer/media-timer/start")
def summer_media_timer_start(body: MediaTimerIn) -> MediaTimerOut:
    """視聴タイマーを開始/再開する（見はじめたとき）。冪等（二重 start で区間を伸ばさない）."""
    return MediaTimerOut(**service.media_timer_start(body.child))


@router.post("/api/summer/media-timer/pause")
def summer_media_timer_pause(body: MediaTimerIn) -> MediaTimerOut:
    """視聴タイマーを一時停止する（やめたとき）。冪等（二重 pause で二重計上しない）."""
    return MediaTimerOut(**service.media_timer_pause(body.child))

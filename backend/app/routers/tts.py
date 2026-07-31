"""VOICEVOX Engine への薄い読み上げプロキシ（オプション機能）.

  GET  /api/tts/status    VOICEVOX が使えるか（フロントは false なら音声ボタンを出さない）
  GET  /api/tts/speakers  使えるキャラクター／スタイル一覧（管理画面の「こえ」えらび用）
  POST /api/tts           テキスト → wav（audio_query → synthesis の2段呼び出し）

VOICEVOX が起動していなければ status=unavailable / 合成は 503 に縮退する。
接続先は環境変数 VOICEVOX_URL（既定 http://localhost:50021）。

話者（キャラクター）は子どもごとに定義（summer_definitions の voice.speaker）で決まる。
child が無い・その子の定義に voice が無い場合は環境変数 VOICEVOX_SPEAKER
（既定 3 = ずんだもん ノーマル）。その既定も含め、VOICEVOX に居ないと分かった話者は
鳴る声へ落とす＝声の設定が古くても読み上げ自体は必ず動く。ただし落とすのは話者一覧を
実際に取れたときだけで、一覧が引けなかった（＝居るか居ないか不明な）ときは設定どおりに読む。
生成音声の利用には VOICEVOX とキャラクターの利用規約が適用される（README 参照）。
"""

from __future__ import annotations

import os
import time

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, StrictInt

from app.summer.definition import SummerDefinitionError, load_definition

router = APIRouter()

VOICEVOX_URL = os.environ.get("VOICEVOX_URL", "http://localhost:50021")
VOICEVOX_SPEAKER = int(os.environ.get("VOICEVOX_SPEAKER", "3"))

TEXT_MAX_BYTES = 10_000
PROBE_TIMEOUT_S = 1.5
SPEAKERS_TIMEOUT_S = 5.0
SYNTH_TIMEOUT_S = 30.0
# 子ども向けにポーズをややゆっくりに（読点・句点の間を伸ばす）
PAUSE_LENGTH_SCALE = 1.2

# 死活 probe の結果キャッシュ（不在 VOICEVOX へのタイムアウト待ちを毎回発生させない）
# at の初期値は -inf。time.monotonic() の原点は環境依存（Linux では起動からの経過秒）なので、
# 0.0 だと「ホスト起動から30秒以内に立ち上がったサーバ」が probe せず available=False を返す
# ＝家の NAS やラズパイのように電源投入と同時に docker が起動する使いかたで、最初の30秒だけ
# 音声ボタンが出ない。初回は必ずミスさせる。
_STATUS_CACHE_TTL_S = 30.0
_status_cache: dict = {"at": float("-inf"), "available": False}

# キャラクター一覧のキャッシュ（50KB 弱あり、合成のたびに引くと重い。VOICEVOX の
# 話者構成はプロセス寿命の間ほぼ不変なので長めの TTL でよい）。失敗は短い TTL で
# キャッシュする＝合成のたびに 5秒待たされず、しかも復旧はすぐ拾える。
# speakers=None は「取れていない（不明）」で、空リスト（＝読み上げできる話者が1人も居ない）
# とは別物。混ぜると「一覧が引けなかっただけ」を「その話者は居ない」と誤断定してしまう。
_SPEAKERS_CACHE_TTL_S = 300.0
_SPEAKERS_FAIL_TTL_S = 30.0
_speakers_cache: dict = {"at": 0.0, "ttl": 0.0, "speakers": None}
# ttl=0.0 なので at の初期値は何でもミスする（_status_cache と違い -inf は不要）。


def _forget_speakers() -> None:
    """話者一覧のキャッシュを捨てる（次の参照で引き直す）."""
    _speakers_cache.update({"at": 0.0, "ttl": 0.0, "speakers": None})


def _probe_available() -> bool:
    now = time.monotonic()
    if now - _status_cache["at"] < _STATUS_CACHE_TTL_S:
        return _status_cache["available"]
    available = False
    try:
        r = httpx.get(f"{VOICEVOX_URL}/version", timeout=PROBE_TIMEOUT_S)
        available = r.status_code == 200
    except httpx.HTTPError:
        available = False
    _status_cache.update({"at": now, "available": available})
    return available


def _fetch_speakers() -> list[dict] | None:
    """使えるキャラクター一覧 [{name, styles:[{id,name}]}]。取れなければ None（＝不明）.

    歌唱用スタイル（type が talk 以外）は読み上げに使えないので落とす。

    応答は「VOICEVOX を名乗る何か」から来る任意の JSON として扱う（別プロセスの
    取り違え・版ちがい・プロキシのエラーページ）。styles が配列でないだけで素の
    TypeError を漏らすと、/api/tts/speakers はもちろん、話者解決を通る
    /api/tts/status と合成まで 500 になる＝読み上げが飾りで済まなくなる。
    """
    now = time.monotonic()
    if now - _speakers_cache["at"] < _speakers_cache["ttl"]:
        return _speakers_cache["speakers"]
    speakers: list[dict] = []
    try:
        r = httpx.get(f"{VOICEVOX_URL}/speakers", timeout=SPEAKERS_TIMEOUT_S)
        r.raise_for_status()
        raw = r.json()
    except (httpx.HTTPError, ValueError):
        _speakers_cache.update({"at": now, "ttl": _SPEAKERS_FAIL_TTL_S, "speakers": None})
        return None
    if not isinstance(raw, list):  # 想定外の応答は「不明」（空一覧として確定させない）
        _speakers_cache.update({"at": now, "ttl": _SPEAKERS_FAIL_TTL_S, "speakers": None})
        return None
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        raw_styles = entry.get("styles")
        if not isinstance(raw_styles, list):  # str も for で回せてしまうので list だけ通す
            continue
        styles = [
            {"id": s["id"], "name": str(s.get("name", ""))}
            for s in raw_styles
            if isinstance(s, dict)
            and isinstance(s.get("id"), int)
            and not isinstance(s.get("id"), bool)
            # 負のIDは合成に渡せない（定義にも保存できない）。一覧に出すと管理画面に
            # 「えらべるのに保存できない声」が並ぶので、ここで落とす。
            and s["id"] >= 0
            and s.get("type", "talk") == "talk"
        ]
        if styles:
            speakers.append({"name": str(entry.get("name", "")), "styles": styles})
    _speakers_cache.update({"at": now, "ttl": _SPEAKERS_CACHE_TTL_S, "speakers": speakers})
    return speakers


def _known_speaker_ids() -> set[int] | None:
    """VOICEVOX に実在する話者ID の集合。一覧が取れていなければ None（＝実在検査をしない）.

    死活キャッシュ（30秒）で先に足切りする。VOICEVOX 不在のとき一覧取得の
    タイムアウトを毎回待たないため。
    """
    if not _probe_available():
        return None
    speakers = _fetch_speakers()
    if speakers is None:
        return None
    return {style["id"] for sp in speakers for style in sp["styles"]}


def _fallback_speaker(known: set[int]) -> int:
    """居ない話者を指していたときの落としどころ.

    まず既定（VOICEVOX_SPEAKER）。その既定すら実在しない VOICEVOX（環境変数の指定ミスや
    モデル構成ちがい）では、実在する最初の話者へ落とす——落とし先が鳴らないのでは
    フォールバックの意味がない。既定を素通しする経路を別に作らないこと（声を設定して
    いない子だけが鳴らない、という不揃いになる）。
    """
    if VOICEVOX_SPEAKER in known:
        return VOICEVOX_SPEAKER
    speakers = _fetch_speakers() or []
    return speakers[0]["styles"][0]["id"] if speakers else VOICEVOX_SPEAKER


def _configured_speaker(child: str | None) -> int:
    """その子の定義に書かれた話者ID（未設定・定義が読めないときは既定）."""
    if not child:
        return VOICEVOX_SPEAKER
    try:
        definition = load_definition(child)
    except SummerDefinitionError:
        # 声は飾りなので、定義が壊れていても読み上げ自体は既定の声で動かす
        return VOICEVOX_SPEAKER
    return definition.voice.speaker if definition.voice else VOICEVOX_SPEAKER


def _resolve_speaker(child: str | None, override: int | None) -> tuple[int, bool]:
    """実際に合成へ渡す話者ID と「実在検査を通したか」を返す（override＞子どもの設定＞既定）.

    別の家からインポートした定義や VOICEVOX の版ちがいで「居ない話者」を指していても、
    黙って鳴る声へ落とす（読み上げボタンが押せるのに毎回エラー、を作らない）。
    実在検査は子どもの設定でも既定でも同じ道を通す＝どの子でも同じように鳴る。
    ただし落とすのは「一覧が取れていて、そこに居ないと分かった」ときだけ。一覧が
    引けなかっただけで設定を無視すると、VOICEVOX が一瞬詰まった隙に別人の声で
    読み上げてしまう。override（管理画面の試聴）は利用者がいま一覧から選んだ値なので落とさない。

    第2要素の checked は「この話者IDを一覧と突き合わせたか」。合成が 4xx で断られたとき、
    一覧を捨てて引き直してよいのは checked のときだけ——一覧が引けずに素通しした話者や
    試聴の直接指定で 4xx を食らっても、それは一覧が古い証拠にならない。区別せずに捨てると、
    正しい一覧を持っていたのに毎回捨てて引き直す（＝合成のたびに /speakers を叩く）。
    """
    if override is not None:
        return override, False
    speaker = _configured_speaker(child)
    known = _known_speaker_ids()
    if known is None:
        return speaker, False
    if speaker in known:
        return speaker, True
    return _fallback_speaker(known), True


@router.get("/api/tts/status")
def tts_status(child: str | None = None) -> dict:
    """VOICEVOX の死活（30秒キャッシュ）。フロントは起動時に1回見るだけでよい.

    speaker は child を渡したときだけその子の設定を反映する（表示・デバッグ用）。
    """
    speaker, _checked = _resolve_speaker(child, None)
    return {"available": _probe_available(), "speaker": speaker}


@router.get("/api/tts/speakers")
def tts_speakers() -> dict:
    """管理画面の「こえ」えらび用のキャラクター一覧.

    available は VOICEVOX 自体の死活。一覧だけ取れなかったときは available=true・
    speakers=[] になる（画面は「VOICEVOX が居ない」と「一覧だけ取れない」を書き分ける。
    一時的な取得失敗を「VOICEVOX がうごいていません」と言い切らないため）。
    """
    if not _probe_available():
        return {"available": False, "speakers": [], "default_speaker": VOICEVOX_SPEAKER}
    return {
        "available": True,
        "speakers": _fetch_speakers() or [],
        "default_speaker": VOICEVOX_SPEAKER,
    }


class TtsIn(BaseModel):
    text: str
    child: str | None = None  # その子の定義の voice.speaker で読む
    # 管理画面の試聴用（child より優先。保存前の声を試す）。StrictInt にするのは、
    # 素の int だと Pydantic の緩い変換で true→1・"3"→3・3.0→3 まで通ってしまい、
    # 定義側（_parse_voice は bool・文字列・小数を拒む）と話者IDの契約がズレるため。
    speaker: StrictInt | None = None


@router.post("/api/tts")
def tts_synthesize(body: TtsIn) -> Response:
    """テキストを VOICEVOX で合成して wav を返す（未起動なら 503）."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text が空です")
    if len(text.encode("utf-8")) > TEXT_MAX_BYTES:
        raise HTTPException(status_code=400, detail="text が長すぎます")
    if body.speaker is not None and body.speaker < 0:
        raise HTTPException(status_code=400, detail="speaker は 0 以上の整数です")
    speaker, checked = _resolve_speaker(body.child, body.speaker)
    try:
        with httpx.Client(timeout=SYNTH_TIMEOUT_S) as client:
            query = client.post(
                f"{VOICEVOX_URL}/audio_query",
                params={"text": text, "speaker": speaker},
            )
            query.raise_for_status()
            payload = query.json()
            payload["pauseLengthScale"] = PAUSE_LENGTH_SCALE
            synth = client.post(
                f"{VOICEVOX_URL}/synthesis",
                params={"speaker": speaker},
                json=payload,
            )
            synth.raise_for_status()
    except httpx.HTTPStatusError as e:
        # 4xx は「頼みかたが悪い」＝ VOICEVOX は生きている（居ない話者IDの試聴など）。
        # ここで死活キャッシュを false へ倒すと、音声ボタンごと消えてしまうので倒さない。
        if 400 <= e.response.status_code < 500:
            if checked:
                # 実在検査を通した話者で断られた＝検査に使った一覧が古い（VOICEVOX の
                # 入れ替え等）。捨てて次回引き直す。古い一覧のまま放置すると、逆に
                # 「本当は居る話者」を居ないと誤判定して設定を無視し続けることになる。
                # 検査していない話者（試聴の直接指定・一覧が引けず素通しした設定）の
                # 4xx は一覧の鮮度と無関係なので、有効な一覧を巻き添えで捨てない。
                _forget_speakers()
            raise HTTPException(
                status_code=400, detail=f"この声（話者ID {speaker}）では合成できません"
            ) from None
        _status_cache.update({"at": time.monotonic(), "available": False})
        raise HTTPException(status_code=503, detail=f"VOICEVOX を利用できません: {e}") from None
    except httpx.HTTPError as e:
        # 接続失敗・タイムアウトはまとめて 503（フロントは無音縮退）
        _status_cache.update({"at": time.monotonic(), "available": False})
        raise HTTPException(status_code=503, detail=f"VOICEVOX を利用できません: {e}") from None
    return Response(content=synth.content, media_type="audio/wav")

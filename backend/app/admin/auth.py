"""ADMIN_PIN による管理 API のゲート（既定はフェイルクローズ）。

- ADMIN_PIN 設定時: POST /api/admin/login で PIN を照合し、プロセス内ランダムトークンを
  HttpOnly クッキーで発行。以後の /api/admin/* はクッキーを検査する。
  サーバ再起動でトークンは失効（再入力）＝家庭用途では許容。
- ADMIN_PIN 未設定（既定）: 管理 API は既定で無効。破壊的な /api/admin/*
  （delete/import/save/rename/purge-orphans など）は資格情報なしでは通らない（403）。
  認証なしの家庭内 LAN モードを使いたい場合は ADMIN_NO_AUTH=1 を明示的に設定する
  （オプトイン。README のセキュリティ注意を参照）。既定で素通しにはしない。

つまり「なにも設定しない」＝拒否（フェイルクローズ）で、無認証モードは
ADMIN_NO_AUTH という単一の明示スイッチでのみ有効になる。ADMIN_PIN が設定されて
いれば、ADMIN_NO_AUTH の有無にかかわらず PIN 検査を優先する。
"""

from __future__ import annotations

import asyncio
import os
import secrets
import time
from dataclasses import dataclass, field

from fastapi import HTTPException, Request

COOKIE_NAME = "admin_session"

_TRUTHY = {"1", "true", "yes", "on"}


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


_admin_pin = os.environ.get("ADMIN_PIN", "")
# 明示オプトイン: ADMIN_PIN 未設定でも管理 API を無認証で開放する（家庭内 LAN 専用）。
# これを立てない限り、ADMIN_PIN 未設定時の管理 API は 403 で拒否される。
_allow_no_auth = _env_flag("ADMIN_NO_AUTH")
# 信頼できるリバースプロキシの後ろにいる（＝backend に直接届く経路が無い）ことの明示。
# docker compose ではフロントのプロキシ経由でしか backend に届かないので立てる。
_trust_proxy_client = _env_flag("TRUST_PROXY_CLIENT_HEADER")
_session_token: str | None = None

# 誤 PIN のブルートフォース抑止（CWE-307）。
# 方針：正しい PIN は throttle より先に定数時間比較して即トークンを返す＝正規の管理者は
# 何回失敗があっても決してブロックされない。遅延は「誤り」応答にのみ掛ける。
# しきい値までの連続失敗は従来どおり遅延なしの 401、しきい値を超えた分にのみ回数に応じた
# 指数バックオフ（上限あり）を掛けてから 401 を返す。ADMIN_PIN は単一のグローバル秘密なので、
# 攻撃者の誤 PIN 連投で正規ログインまで巻き込まないよう、グローバルなロックアウトは設けない。
#
# ただし「遅らせるだけ」では並列に投げられると意味がない：誤 PIN の遅延が同時に消化され、
# 4桁の鍵空間を一斉に投げれば正解だけが遅延ゼロで返る（バックオフの回避）。
# かといって全員を1本の待ち行列に並べると、誤 PIN が数件先行しただけで正しい PIN まで
# 待たされ、やがてタイムアウトする＝攻撃者が管理者を締め出せてしまう。
#
# そこでスロットルを「呼び出し元（端末）ごと」に持つ。同じ端末からの試行だけが直列化・
# バックオフされ、別の端末からの正しい PIN はいっさい影響を受けない（待たない・429 にならない）。
#
# 呼び出し元の判別は x-real-client ヘッダだが、これは **信頼できるプロキシの後ろにいると
# 明示されたときだけ** 採用する（TRUST_PROXY_CLIENT_HEADER=1）。無条件に信じると、
# backend に直接届く経路（README の手動セットアップは 0.0.0.0:8000 で待ち受ける／Vite の
# dev プロキシはこのヘッダを上書きしない）で、誤 PIN ごとに違う値を送るだけで毎回まっさらな
# スロットルが作られ、バックオフも待ち行列上限も丸ごと回避できてしまう。
# 明示が無いときは socket の送信元（request.client.host）を使う。
_FAILURE_THRESHOLD = 5  # ここまでの連続失敗は遅延なし
_BACKOFF_BASE_SECONDS = 0.5  # しきい値超過後の初回遅延
_BACKOFF_MAX_SECONDS = 5.0  # 遅延の上限（ワーカー／イベントループを長時間占有しない）
# 同じ端末から同時に並べる試行数（超過はその端末だけ 429。他端末には影響しない）
_MAX_WAITING_PER_CLIENT = 4
_CLIENT_HEADER = "x-real-client"  # 信頼できるプロキシが必ず上書きして渡す
_MAX_TRACKED_CLIENTS = 512  # 追跡する端末数の上限（メモリを無制限に伸ばさない）
_CLIENT_TTL_SECONDS = 900.0  # この時間さわられていない端末の記録は捨てる


@dataclass
class _ClientThrottle:
    """1つの端末ぶんのスロットル状態."""

    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    failures: int = 0  # 連続失敗（その端末の成功でリセット）
    waiting: int = 0  # いま順番待ちしている試行数
    last_seen: float = 0.0


_throttles: dict[str, _ClientThrottle] = {}


async def _sleep(seconds: float) -> None:
    """誤 PIN 応答を遅らせる実体。asyncio.sleep でイベントループを塞がず、テストは差し替え可能."""
    await asyncio.sleep(seconds)


# 上限に達する回数（これ以上は指数計算をせずに頭打ちの値を返す）。
# 先に頭打ちにしないと、連続失敗が1030回を超えたあたりで 0.5 * 2**1024 が float の
# 範囲を超えて OverflowError になり、以後の誤 PIN が「遅延なしの 500」になってしまう
# ＝しばらく殴り続けるだけで throttle を無効化できる。
_BACKOFF_MAX_OVER = 1 + int(_BACKOFF_MAX_SECONDS / _BACKOFF_BASE_SECONDS).bit_length()


def _backoff_seconds(consecutive_failures: int) -> float:
    """しきい値を超えた連続失敗回数から遅延秒数を求める（指数・上限あり）."""
    over = consecutive_failures - _FAILURE_THRESHOLD
    if over <= 0:
        return 0.0
    if over >= _BACKOFF_MAX_OVER:
        return _BACKOFF_MAX_SECONDS
    return min(_BACKOFF_BASE_SECONDS * (2 ** (over - 1)), _BACKOFF_MAX_SECONDS)


def pin_required() -> bool:
    return bool(_admin_pin)


def no_auth_mode() -> bool:
    """認証なしの家庭内 LAN モードか（ADMIN_PIN 未設定＋ADMIN_NO_AUTH の明示オプトイン）."""
    return not pin_required() and _allow_no_auth


def client_key(request: Request) -> str:
    """スロットルの単位（呼び出し元の端末）.

    x-real-client は TRUST_PROXY_CLIENT_HEADER=1 のときだけ採用する。立てていない環境で
    信じてしまうと、誤 PIN ごとに違う値を送るだけでスロットルを毎回作り直せる（＝丸ごと回避）。
    """
    if _trust_proxy_client:
        forwarded = request.headers.get(_CLIENT_HEADER)
        if forwarded:
            return forwarded.strip()
    return request.client.host if request.client else "unknown"


def _prune_throttles(now: float) -> None:
    """古い端末の記録を捨てる（待機中のものは残す）."""
    for key in [k for k, v in _throttles.items() if not v.waiting and now - v.last_seen > _CLIENT_TTL_SECONDS]:
        del _throttles[key]
    if len(_throttles) >= _MAX_TRACKED_CLIENTS:
        oldest = sorted(_throttles.items(), key=lambda kv: kv[1].last_seen)
        for key, state in oldest[: len(oldest) // 2]:
            if not state.waiting:
                del _throttles[key]


def _throttle_for(client: str) -> _ClientThrottle:
    now = time.monotonic()
    state = _throttles.get(client)
    if state is None:
        _prune_throttles(now)
        state = _throttles[client] = _ClientThrottle()
    state.last_seen = now
    return state


async def login(pin: str, client: str = "unknown") -> str:
    """PIN を照合してセッショントークンを返す（不一致は 401）.

    スロットルは端末ごと。同じ端末からの試行だけが直列化され、しきい値を超えた連続失敗の
    ぶんだけ遅延してから 401 を返す。別の端末からの正しい PIN は待たされない＝誤 PIN の
    連投で正規の管理者を締め出せない。同じ端末から一斉に投げた場合だけ 429 になる。
    """
    if not pin_required():
        raise HTTPException(status_code=400, detail="ADMIN_PIN は設定されていません")
    global _session_token
    throttle = _throttle_for(client)
    if throttle.waiting >= _MAX_WAITING_PER_CLIENT:
        raise HTTPException(
            status_code=429,
            detail="ログインの試行が混み合っています。すこし待ってからもう一度おしてください。",
            headers={"Retry-After": str(int(_BACKOFF_MAX_SECONDS))},
        )
    throttle.waiting += 1
    try:
        async with throttle.lock:
            # 成功は最優先：定数時間比較し、一致したら失敗カウンタをリセットして即発行
            if secrets.compare_digest(pin.encode("utf-8"), _admin_pin.encode("utf-8")):
                throttle.failures = 0
                if _session_token is None:
                    _session_token = secrets.token_urlsafe(32)
                return _session_token
            # 失敗のみ throttle：遅延はロックを持ったまま消化する＝同じ端末の次の試行が待たされる
            throttle.failures += 1
            delay = _backoff_seconds(throttle.failures)
            if delay > 0:
                await _sleep(delay)
            raise HTTPException(status_code=401, detail="PIN がちがいます")
    finally:
        throttle.waiting -= 1


def require_admin(request: Request) -> None:
    """管理 API の dependency。

    - ADMIN_PIN 設定時: セッションクッキーを検査する（不一致は 401）。
    - ADMIN_PIN 未設定 + ADMIN_NO_AUTH の明示オプトイン: 素通し（家庭内 LAN モード）。
    - どちらも無い既定: フェイルクローズで拒否（403）。
    """
    if not pin_required():
        if no_auth_mode():
            return
        raise HTTPException(
            status_code=403,
            detail=(
                "管理 API は無効です。ADMIN_PIN を設定するか、"
                "家庭内 LAN 専用として ADMIN_NO_AUTH=1 を明示してください。"
            ),
        )
    token = request.cookies.get(COOKIE_NAME)
    if not (
        _session_token
        and token
        and secrets.compare_digest(token.encode("utf-8"), _session_token.encode("utf-8"))
    ):
        raise HTTPException(status_code=401, detail="管理画面のログインが必要です")

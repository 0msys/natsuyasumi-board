"""管理エンドポイント（app/routers/admin.py）の結合テスト.

create→GET→validate→PUT→PUT(古いrevision)=409→export→import→rename→delete の一連の流れと、
ADMIN_PIN ゲートを固定する:
- 既定（PIN 未設定・ADMIN_NO_AUTH 未設定）は管理 API をフェイルクローズで拒否（403）
- 認証なしの家庭内 LAN モードは ADMIN_NO_AUTH の明示オプトインでのみ素通し
- ADMIN_PIN 設定時は cookie 必須・誤 PIN は 401
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

PERIOD = {"start": "2026-07-18", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}


def _make_client(tmp_db, monkeypatch, pin: str, allow_no_auth: bool = False) -> TestClient:
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", tmp_db)
    monkeypatch.setattr("app.admin.auth._admin_pin", pin)
    monkeypatch.setattr("app.admin.auth._allow_no_auth", allow_no_auth)
    monkeypatch.setattr("app.admin.auth._session_token", None)
    monkeypatch.setattr("app.admin.auth._throttles", {})  # スロットルは端末ごと
    # 「今日」を期間中に固定（validate の mid_period 系 warning・check/set の未来日判定を安定化）
    monkeypatch.setattr("app.summer.service.today_jst", lambda: date(2026, 8, 1))
    return TestClient(create_app())


@pytest.fixture
def client(tmp_db, monkeypatch):
    # 認証なしの家庭内 LAN モード（明示オプトイン）。CRUD 系の検証に使う。
    with _make_client(tmp_db, monkeypatch, pin="", allow_no_auth=True) as c:
        yield c


@pytest.fixture
def closed_client(tmp_db, monkeypatch):
    # 既定（PIN 未設定・オプトインなし）＝フェイルクローズ。
    with _make_client(tmp_db, monkeypatch, pin="", allow_no_auth=False) as c:
        yield c


@pytest.fixture
def pin_client(tmp_db, monkeypatch):
    with _make_client(tmp_db, monkeypatch, pin="4649") as c:
        yield c


# ---- CRUD 一連の流れ（ADMIN_NO_AUTH オプトインで素通し） ----


def test_crud一連の流れ(client):
    # 1. ウィザード新規作成（standard テンプレート）
    r = client.post(
        "/api/admin/definitions",
        json={"child": "はな", "child_kana": "はな", "grade": "小1", "year": 2026, "period": PERIOD},
    )
    assert r.status_code == 200
    assert r.json()["child"] == "はな" and r.json()["revision"] == 1

    # 一覧に出る
    r = client.get("/api/admin/definitions")
    assert [d["child"] for d in r.json()["definitions"]] == ["はな"]

    # 2. 編集用ドキュメント取得
    r = client.get("/api/admin/definitions/はな")
    assert r.status_code == 200
    entry = r.json()
    assert entry["revision"] == 1 and entry["doc"]["child"] == "はな"
    doc = entry["doc"]
    assert any(h["key"] == "hamigaki_asa" for h in doc["habits"])  # standard テンプレート由来

    # 3. ドライラン検証（常に 200）
    r = client.post("/api/admin/definitions/はな/validate", json={"doc": doc})
    assert r.status_code == 200 and r.json()["ok"] is True

    # 4. 全文置換保存（楽観ロック）
    doc["daily_homework"][0]["label"] = "おんどく（まいにち）"
    r = client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": 1})
    assert r.status_code == 200 and r.json()["revision"] == 2

    # 5. 古い revision での PUT は 409
    r = client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": 1})
    assert r.status_code == 409

    # 6. export（JSON ダウンロード）
    r = client.get("/api/admin/definitions/はな/export")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment;")
    exported = json.loads(r.content.decode("utf-8"))
    assert exported["child"] == "はな"
    assert exported["daily_homework"][0]["label"] == "おんどく（まいにち）"

    # 7. import: 同名は 409・別名なら新規作成できる
    r = client.post("/api/admin/definitions/import", json={"doc": exported})
    assert r.status_code == 409
    other = dict(exported, child="ゆき", child_kana="ゆき")
    r = client.post("/api/admin/definitions/import", json={"doc": other})
    assert r.status_code == 200 and r.json()["child"] == "ゆき"

    # 8. rename（既存名への変更は 409）
    r = client.post("/api/admin/definitions/はな/rename", json={"new": "ゆき"})
    assert r.status_code == 409
    r = client.post("/api/admin/definitions/はな/rename", json={"new": "ももこ"})
    assert r.status_code == 200 and r.json() == {"ok": True, "child": "ももこ"}
    r = client.get("/api/admin/definitions")
    assert sorted(d["child"] for d in r.json()["definitions"]) == ["ももこ", "ゆき"]

    # 9. delete（定義は消える・再 delete は 404）
    r = client.request("DELETE", "/api/admin/definitions/ももこ")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.get("/api/admin/definitions/ももこ").status_code == 404
    assert client.request("DELETE", "/api/admin/definitions/ももこ").status_code == 404


def test_create_エラー系(client):
    base = {"child": "はな", "grade": "小1", "year": 2026, "period": PERIOD}
    # 不明テンプレート → 400
    assert client.post("/api/admin/definitions", json={**base, "template": "nope"}).status_code == 400
    # 不正 grade → 422（parse_definition の拒否を DefinitionStoreError 422 に変換）
    assert client.post("/api/admin/definitions", json={**base, "grade": "小9"}).status_code == 422
    # 正常作成後の同名 create → 409
    assert client.post("/api/admin/definitions", json=base).status_code == 200
    assert client.post("/api/admin/definitions", json=base).status_code == 409


def test_validate_usage連携で削除警告(client):
    client.post(
        "/api/admin/definitions",
        json={"child": "はな", "grade": "小1", "year": 2026, "period": PERIOD},
    )
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    # ondoku に記録を作る → ondoku を消した doc の validate に警告が出る
    client_summer = client  # 同一 app（summer ルーターも載っている）
    client_summer.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-07-20", "item_key": "ondoku", "status": "done"},
    )
    pruned = dict(doc, daily_homework=[i for i in doc["daily_homework"] if i["key"] != "ondoku"])
    r = client.post("/api/admin/definitions/はな/validate", json={"doc": pruned})
    assert r.status_code == 200
    codes = [w["code"] for w in r.json()["warnings"]]
    assert "delete_with_records" in codes


def test_import_不正docは422(client):
    r = client.post("/api/admin/definitions/import", json={"doc": {"child": "はな"}})
    assert r.status_code == 422


def test_usage_エンドポイント(client):
    client.post(
        "/api/admin/definitions",
        json={"child": "はな", "grade": "小1", "year": 2026, "period": PERIOD},
    )
    client.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-07-20", "item_key": "ondoku", "status": "done"},
    )
    r = client.get("/api/admin/definitions/はな/usage")
    assert r.status_code == 200 and r.json()["usage"] == {"ondoku": 1}


def test_kanji_エンドポイント(client):
    r = client.get("/api/admin/kanji")
    assert r.status_code == 200
    grades = r.json()["grades"]
    assert sorted(grades) == ["1", "2", "3", "4", "5", "6"]
    assert len(grades["1"]) == 80 and len(grades["4"]) == 202


# ---- ADMIN_PIN ゲート ----


def test_no_authオプトインは素通し(client):
    # ADMIN_NO_AUTH の明示オプトイン時のみ、PIN 未設定でも管理 API が通る。
    assert client.get("/api/admin/session").json() == {
        "pin_required": False,
        "authenticated": True,
        "admin_disabled": False,  # ADMIN_NO_AUTH の明示オプトイン中
    }
    assert client.get("/api/admin/definitions").status_code == 200
    # PIN 未設定時の login は 400
    assert client.post("/api/admin/login", json={"pin": "0000"}).status_code == 400


def test_既定はフェイルクローズで拒否(closed_client):
    # PIN も ADMIN_NO_AUTH も未設定なら、管理 API は既定で拒否される（403）。
    # admin_disabled でこの状態を明示する（pin_required=False だけだと
    # フロントが「PIN 不要で入れる」と誤読し、保存時にだけ 403 になる）。
    assert closed_client.get("/api/admin/session").json() == {
        "pin_required": False,
        "authenticated": False,
        "admin_disabled": True,
    }
    # 参照系も破壊系も、資格情報なしでは通らない。
    assert closed_client.get("/api/admin/definitions").status_code == 403
    assert (
        closed_client.post(
            "/api/admin/definitions",
            json={"child": "はな", "grade": "小1", "year": 2026, "period": PERIOD},
        ).status_code
        == 403
    )
    assert closed_client.request("DELETE", "/api/admin/definitions/はな").status_code == 403
    assert closed_client.post("/api/admin/definitions/はな/purge-orphans").status_code == 403
    assert (
        closed_client.post("/api/admin/definitions/import", json={"doc": {}}).status_code == 403
    )
    assert (
        closed_client.put(
            "/api/admin/definitions/はな", json={"doc": {}, "revision": 1}
        ).status_code
        == 403
    )
    assert (
        closed_client.post(
            "/api/admin/definitions/はな/rename", json={"new": "ゆき"}
        ).status_code
        == 403
    )
    # PIN 未設定なので login も掛けられない（400）。
    assert closed_client.post("/api/admin/login", json={"pin": "0000"}).status_code == 400
    # 子ども向け API は管理ゲートの対象外なので通常どおり使える。
    assert closed_client.get("/api/summer/children").status_code == 200


def test_pin設定時はcookie必須(pin_client):
    assert pin_client.get("/api/admin/session").json() == {
        "pin_required": True,
        "authenticated": False,
        "admin_disabled": False,  # PIN を入れれば入れる
    }
    # cookie 無しの管理 API は 401
    assert pin_client.get("/api/admin/definitions").status_code == 401
    r = pin_client.post(
        "/api/admin/definitions",
        json={"child": "はな", "grade": "小1", "year": 2026, "period": PERIOD},
    )
    assert r.status_code == 401

    # 誤 PIN は 401（cookie は付かない）
    assert pin_client.post("/api/admin/login", json={"pin": "0000"}).status_code == 401
    assert pin_client.get("/api/admin/definitions").status_code == 401

    # 正しい PIN → cookie 発行 → 通る
    r = pin_client.post("/api/admin/login", json={"pin": "4649"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "admin_session" in r.cookies
    assert pin_client.get("/api/admin/definitions").status_code == 200
    assert pin_client.get("/api/admin/session").json() == {
        "pin_required": True,
        "authenticated": True,
        "admin_disabled": False,
    }

    # 子ども向け API は PIN ゲートの対象外
    assert pin_client.get("/api/summer/children").status_code == 200


def test_pin設定時_偽cookieは401(pin_client):
    pin_client.cookies.set("admin_session", "fake-token")
    assert pin_client.get("/api/admin/definitions").status_code == 401


# ---- 誤 PIN のブルートフォース抑止（CWE-307）：成功は常に通し、失敗のみ遅延させる ----


def _patch_sleep(monkeypatch) -> list[float]:
    """auth._sleep を「実際には待たず秒数だけ記録する」差し替えにし、記録リストを返す."""
    recorded: list[float] = []

    async def _no_wait(seconds: float) -> None:
        recorded.append(seconds)

    monkeypatch.setattr("app.admin.auth._sleep", _no_wait)
    return recorded


def test_pin正しいPINは連続失敗後も必ず通る_DoS耐性(pin_client, monkeypatch):
    """新テスト：誤 PIN を大量に投げても、正しい PIN のログインは決して妨げられない。

    バックオフは「誤り」応答にのみ掛かり、正しい PIN は throttle より先に定数時間比較して
    即トークンを返すため、攻撃者の誤 PIN 連投で正規の管理者が締め出されることはない。
    """
    import app.admin.auth as auth

    _patch_sleep(monkeypatch)  # テストは実際には待たない
    # しきい値を大きく超える回数だけ誤 PIN を投げる（＝旧実装ならグローバルロックアウトが張られる状況）
    for _ in range(20):
        assert pin_client.post("/api/admin/login", json={"pin": "0000"}).status_code == 401
    # それでも正しい PIN は常に 200・cookie 発行され、管理 API を通れる
    r = pin_client.post("/api/admin/login", json={"pin": "4649"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "admin_session" in r.cookies
    assert pin_client.get("/api/admin/definitions").status_code == 200
    # 成功でその端末の失敗カウンタはリセットされる（以降は再びしきい値まで遅延なし）
    assert all(t.failures == 0 for t in auth._throttles.values())


def test_pin誤りは初回から401でしきい値までは遅延なし(pin_client, monkeypatch):
    sleeps = _patch_sleep(monkeypatch)
    for _ in range(5):  # _FAILURE_THRESHOLD 回までは即 401・遅延なし
        assert pin_client.post("/api/admin/login", json={"pin": "0000"}).status_code == 401
    assert sleeps == []


def test_pin連続失敗でバックオフが掛かる(pin_client, monkeypatch):
    sleeps = _patch_sleep(monkeypatch)
    for _ in range(5):  # しきい値まで消費（遅延なし）
        pin_client.post("/api/admin/login", json={"pin": "0000"})
    assert sleeps == []
    # しきい値超過の 6 回目以降は遅延が掛かる（指数バックオフ）
    assert pin_client.post("/api/admin/login", json={"pin": "0000"}).status_code == 401
    assert len(sleeps) == 1 and sleeps[0] > 0
    # 失敗を重ねると遅延は増えるが、上限（_BACKOFF_MAX_SECONDS）で頭打ちになる
    for _ in range(10):
        pin_client.post("/api/admin/login", json={"pin": "0000"})
    assert sleeps == sorted(sleeps)  # 単調増加してから
    assert max(sleeps) == 5.0 and sleeps[-1] == 5.0  # 上限で頭打ち
    # 途中で正しい PIN を通すとカウンタがリセットされ、再びしきい値まで遅延なしに戻る
    assert pin_client.post("/api/admin/login", json={"pin": "4649"}).status_code == 200
    before = len(sleeps)
    for _ in range(5):
        pin_client.post("/api/admin/login", json={"pin": "0000"})
    assert len(sleeps) == before  # リセット後のしきい値内は遅延なし


# ---- 並列の総当たり対策（端末ごとのスロットル） ----


def test_バックオフは連続失敗が何回でも上限で頭打ち():
    """指数を先に頭打ちにしないと 0.5 * 2**1024 が OverflowError になり、

    以後の誤 PIN が「遅延なしの 500」になる＝しばらく殴るだけで throttle を無効化できる。
    """
    from app.admin import auth

    assert auth._backoff_seconds(auth._FAILURE_THRESHOLD) == 0.0
    assert auth._backoff_seconds(auth._FAILURE_THRESHOLD + 1) == auth._BACKOFF_BASE_SECONDS
    for n in (50, 1030, 10_000, 10**6):
        assert auth._backoff_seconds(n) == auth._BACKOFF_MAX_SECONDS, n


def _scaled_backoff(monkeypatch, seconds: float = 0.02) -> None:
    """実時間を縮尺した「本物の待機」にする（sleep を 0 に潰すと待ちが消えて検証にならない）."""
    monkeypatch.setattr("app.admin.auth._FAILURE_THRESHOLD", 0)
    monkeypatch.setattr("app.admin.auth._BACKOFF_BASE_SECONDS", seconds)
    monkeypatch.setattr("app.admin.auth._BACKOFF_MAX_SECONDS", seconds)
    monkeypatch.setattr("app.admin.auth._throttles", {})


def test_同じ端末では誤PINの遅延が並列に消化されない(monkeypatch):
    """誤 PIN を一斉に投げると遅延が同時に消化され、鍵空間を1回の遅延で舐められてしまう."""
    import asyncio

    from app.admin import auth

    monkeypatch.setattr("app.admin.auth._admin_pin", "1234")
    monkeypatch.setattr("app.admin.auth._FAILURE_THRESHOLD", 0)  # 4件すべてが遅延対象になる
    monkeypatch.setattr("app.admin.auth._throttles", {})
    overlap = {"now": 0, "max": 0}

    async def _tracking_sleep(seconds: float) -> None:
        overlap["now"] += 1
        overlap["max"] = max(overlap["max"], overlap["now"])
        await asyncio.sleep(0)
        overlap["now"] -= 1

    monkeypatch.setattr("app.admin.auth._sleep", _tracking_sleep)

    async def _flood() -> list[BaseException]:
        return await asyncio.gather(
            *(auth.login("0000", "attacker") for _ in range(4)), return_exceptions=True
        )

    results = asyncio.run(_flood())
    assert all(getattr(r, "status_code", None) == 401 for r in results)
    assert auth._throttles["attacker"].failures == 4
    assert overlap["max"] == 1, "誤 PIN の遅延が並列に消化されている＝バックオフを回避できる"


def test_攻撃中の端末とは別端末なら正しいPINは待たされない(monkeypatch):
    """総当たり対策で正規の管理者を締め出さないこと。

    誤 PIN を投げ続けている端末とは別の端末から正しい PIN を出し、待たされず・429 にも
    ならずトークンが出ることを、**実時間を縮尺した本物の待機**で確認する
    （sleep を 0 に潰すと、本番なら待たされるケースを隠してしまう）。
    """
    import asyncio
    import time as _time

    from app.admin import auth

    monkeypatch.setattr("app.admin.auth._admin_pin", "1234")
    monkeypatch.setattr("app.admin.auth._session_token", None)
    _scaled_backoff(monkeypatch, 0.02)

    async def _run() -> tuple[object, float, float]:
        # 攻撃端末は同時 4 件までしか並べないので、順に投げ続ける形で負荷をかける
        async def _attack() -> None:
            for _ in range(12):
                try:
                    await auth.login("0000", "attacker")
                except Exception:  # noqa: BLE001 - 401/429 のどちらでもよい
                    pass

        attackers = [asyncio.create_task(_attack()) for _ in range(4)]
        await asyncio.sleep(0.01)  # 攻撃を走らせてから管理者が来る
        t0 = _time.perf_counter()
        token = await auth.login("1234", "admin")
        elapsed = _time.perf_counter() - t0
        t1 = _time.perf_counter()
        await asyncio.gather(*attackers)
        return token, elapsed, _time.perf_counter() - t1

    token, elapsed, attack_tail = asyncio.run(_run())
    assert isinstance(token, str) and token, "攻撃中に正しい PIN が通らなかった"
    assert elapsed < 0.02, f"別端末なのに待たされている: {elapsed:.3f}s"
    assert attack_tail > 0.0, "攻撃側がまだ走っている最中の計測になっていない"
    assert auth._throttles["admin"].failures == 0


def test_同じ端末から一斉に投げるとその端末だけ429(monkeypatch):
    """絞るのは端末単位。他端末は巻き込まない（＝管理者を締め出せない）."""
    import asyncio

    from app.admin import auth

    monkeypatch.setattr("app.admin.auth._admin_pin", "1234")
    _scaled_backoff(monkeypatch, 0.02)

    async def _run() -> tuple[list[BaseException], object]:
        flood = [auth.login("0000", "attacker") for _ in range(20)]
        results = await asyncio.gather(*flood, return_exceptions=True)
        return results, await auth.login("1234", "admin")

    results, token = asyncio.run(_run())
    codes = {getattr(r, "status_code", None) for r in results}
    assert codes == {401, 429}, f"想定外の応答: {codes}"
    assert isinstance(token, str) and token, "他端末が巻き込まれている"


def test_正しいPINは連続失敗まみれでも発行される(monkeypatch):
    """同じ端末でも、グローバルなロックアウトは張らない."""
    import asyncio

    from app.admin import auth

    monkeypatch.setattr("app.admin.auth._admin_pin", "1234")
    monkeypatch.setattr("app.admin.auth._session_token", None)
    monkeypatch.setattr("app.admin.auth._throttles", {})
    monkeypatch.setattr("app.admin.auth._sleep", lambda _s: asyncio.sleep(0))
    auth._throttle_for("same").failures = 10**6
    token = asyncio.run(auth.login("1234", "same"))
    assert token and auth._throttles["same"].failures == 0


def test_信頼フラグが無ければクライアントヘッダを信じない(monkeypatch):
    """x-real-client を無条件に信じると、誤 PIN ごとに違う値を送るだけで

    スロットルを毎回まっさらに作り直せる（バックオフも待ち行列上限も丸ごと回避）。
    backend に直接届きうる構成（手動セットアップ・Vite dev プロキシ）で成立する。
    """
    from app.admin import auth

    class _Req:
        def __init__(self, headers: dict[str, str], host: str) -> None:
            self.headers = headers
            self.client = type("C", (), {"host": host})()

    request = _Req({"x-real-client": "spoofed-every-time"}, "10.0.0.5")

    monkeypatch.setattr("app.admin.auth._trust_proxy_client", False)
    assert auth.client_key(request) == "10.0.0.5", "信頼していないヘッダを採用している"

    monkeypatch.setattr("app.admin.auth._trust_proxy_client", True)
    assert auth.client_key(request) == "spoofed-every-time"

    # ヘッダが無ければ、信頼していても socket の送信元に落ちる
    assert auth.client_key(_Req({}, "10.0.0.9")) == "10.0.0.9"

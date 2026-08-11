"""年またぎ（来年ぶんの定義を前年からコピーして作る）の回帰テスト.

守りたいこと:
- 夏の最中に来年ぶんを作っても、子ども画面は**今年のまま**（いちばん壊したくない性質）
- 来年ぶんに去年の記録が持ち越されない（summer_flags は年を持たないので、キーで分ける）
- 去年の記録が「定義に無いキー」として掃除されない（purge-orphans は全年の定義を見る）
- 年を指定して去年ぶんを読み書きできる／年を書き換えて別の年に化けさせられない
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.summer.definition import select_definition_year

PERIOD = {"start": "2026-07-18", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}
Y2026 = ("2026-07-18", "2026-08-31")
Y2027 = ("2027-07-18", "2027-08-31")


def _client(tmp_db, monkeypatch, today: date) -> TestClient:
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", tmp_db)
    monkeypatch.setattr("app.admin.auth._admin_pin", "")
    monkeypatch.setattr("app.admin.auth._allow_no_auth", True)
    monkeypatch.setattr("app.admin.auth._session_token", None)
    monkeypatch.setattr("app.admin.auth._throttles", {})
    monkeypatch.setattr("app.summer.service.today_jst", lambda: today)
    return TestClient(create_app())


@pytest.fixture
def client(tmp_db, monkeypatch):
    """夏の最中（2026-08-01）に「はな」（小2）が1人だけ居る状態."""
    with _client(tmp_db, monkeypatch, date(2026, 8, 1)) as c:
        r = c.post(
            "/api/admin/definitions",
            json={"child": "はな", "child_kana": "はな", "grade": "小2", "year": 2026, "period": PERIOD},
        )
        assert r.status_code == 200
        yield c


def _travel(monkeypatch, today: date) -> None:
    """「今日」を動かす（同じ DB を別の日から見る）."""
    monkeypatch.setattr("app.summer.service.today_jst", lambda: today)


def _keys(doc: dict) -> set[str]:
    keys = {i["key"] for section in ("habits", "daily_homework",
                                     "special_challenges", "one_shot_homework",
                                     "school_start_items", "rewards")
            for i in doc[section]}
    for group in doc["choice_homework"]:
        keys.add(group["key"])
        keys.update(o["key"] for o in group["options"])
    return keys


# ---- 年の選び方（純関数） ----


@pytest.mark.parametrize(
    ("today", "candidates", "expected", "なぜ"),
    [
        (date(2026, 8, 1), [(2026, Y2026), (2027, Y2027)], 2026, "夏の最中は今年"),
        (date(2026, 7, 1), [(2026, Y2026)], 2026, "夏の直前でも1年しか無ければそれ"),
        (date(2026, 12, 1), [(2026, Y2026), (2027, Y2027)], 2026, "秋冬は直近に終わった夏を見返せる"),
        (date(2027, 6, 1), [(2026, Y2026), (2027, Y2027)], 2026, "次の夏が始まるまでは去年のまま"),
        (date(2027, 7, 18), [(2026, Y2026), (2027, Y2027)], 2027, "初日から新しい年に切り替わる"),
        (date(2027, 8, 1), [(2026, Y2026), (2027, Y2027)], 2027, "翌年の夏は翌年"),
        (date(2026, 1, 1), [(2026, Y2026)], 2026, "これから来る夏しか無ければそれ"),
        (date(2026, 8, 1), [(2026, None), (2027, None)], 2027, "期間が読めない（壊れた）年は年の大きいほう"),
        (date(2026, 8, 1), [(2026, Y2026), (2027, None)], 2026, "壊れた年より、期間が合う年"),
    ],
)
def test_年の選び方(today, candidates, expected, なぜ):
    assert select_definition_year(candidates, today) == expected, なぜ


# ---- コピーして作る ----


def test_来年ぶんを作ると学年と日付が1年ぶん進む(client):
    r = client.post("/api/admin/definitions/はな/next-year")
    assert r.status_code == 200
    entry = r.json()
    assert entry["year"] == 2027 and entry["revision"] == 1
    doc = entry["doc"]
    assert doc["child"] == "はな" and doc["grade"] == "小3"  # 小2 の次
    assert doc["period"] == {
        "start": "2027-07-18",
        "end": "2027-08-31",
        "first_day_of_school": "2027-09-01",
    }
    assert all(i["due"].startswith("2027-") for i in doc["school_start_items"])
    assert doc["away"] == []  # 去年の帰省予定は引き継がない
    # 項目の中身（ラベル）はそのまま引き継ぐ
    src = client.get("/api/admin/definitions/はな?year=2026").json()["doc"]
    assert [i["label"] for i in doc["habits"]] == [i["label"] for i in src["habits"]]


def test_来年ぶんのキーは去年と1つも重ならない(client):
    src = client.get("/api/admin/definitions/はな").json()["doc"]
    doc = client.post("/api/admin/definitions/はな/next-year").json()["doc"]
    assert _keys(src) and _keys(doc)
    assert _keys(src) & _keys(doc) == set()  # summer_flags は年を持たないので混ざる


def test_きかん限定の習慣の期間も1年ぶん進む(client):
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    doc["habits"].append(
        {
            "key": "h_radio",
            "label": "ラジオたいそう",
            "window": "range",
            "window_start": "2026-07-21",
            "window_end": "2026-07-24",
        }
    )
    r = client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": 1})
    assert r.status_code == 200
    next_doc = client.post("/api/admin/definitions/はな/next-year").json()["doc"]
    radio = next((h for h in next_doc["habits"] if h["label"] == "ラジオたいそう"), None)
    assert radio == pytest.approx(radio)  # 存在すること（下の assert のための明示）
    assert radio["window_start"] == "2027-07-21" and radio["window_end"] == "2027-07-24"


def test_小6の次は作れない(client):
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    doc["grade"] = "小6"
    assert client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": 1}).status_code == 200
    r = client.post("/api/admin/definitions/はな/next-year")
    assert r.status_code == 400 and "小6" in r.json()["detail"]


def test_同じ年をもう一度は作れない(client):
    assert client.post("/api/admin/definitions/はな/next-year").status_code == 200
    # 2027 が既にあるので、次に作れるのは 2028（2027 の複製にはならない）
    r = client.post("/api/admin/definitions/はな/next-year")
    assert r.status_code == 200 and r.json()["year"] == 2028
    assert client.get("/api/admin/definitions/はな").json()["years"] == [2026, 2027, 2028]


# ---- 子ども画面はどの年を出すか ----


def test_夏の最中に来年ぶんを作っても子ども画面は今年のまま(client, monkeypatch):
    client.post("/api/admin/definitions/はな/next-year")
    state = client.get("/api/summer/state?child=はな").json()
    assert state["period"]["start"] == "2026-07-18"  # 今日（2026-08-01）を含む年
    assert state["grade"] == "小2"

    _travel(monkeypatch, date(2026, 12, 1))  # 秋冬は直近に終わった夏を見返せる
    assert client.get("/api/summer/state?child=はな").json()["period"]["start"] == "2026-07-18"

    _travel(monkeypatch, date(2027, 8, 1))  # 翌年の夏になったら切り替わる
    state = client.get("/api/summer/state?child=はな").json()
    assert state["period"]["start"] == "2027-07-18" and state["grade"] == "小3"


def test_来年ぶんに去年の記録は出てこない(client, monkeypatch):
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    doc["one_shot_homework"] = [{"label": "絵日記《えにっき》", "required": True}]  # 標準テンプレには無い
    assert client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": 1}).status_code == 200
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    one_shot_key = doc["one_shot_homework"][0]["key"]
    daily_key = doc["daily_homework"][0]["key"]
    assert client.post("/api/summer/flag/toggle", json={"child": "はな", "item_key": one_shot_key}).status_code == 200
    assert client.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-08-01", "item_key": daily_key, "status": "done"},
    ).status_code == 200

    client.post("/api/admin/definitions/はな/next-year")
    _travel(monkeypatch, date(2027, 8, 1))
    state = client.get("/api/summer/state?child=はな").json()
    assert all(not i["done"] for i in state["one_shot"])
    assert all(not day["statuses"] for day in state["history"])

    _travel(monkeypatch, date(2026, 8, 1))  # 去年の画面に戻れば記録はそのまま
    state = client.get("/api/summer/state?child=はな").json()
    assert any(i["done"] for i in state["one_shot"])


# ---- 年を指定した読み書き ----


def test_年を指定して去年ぶんを直せる(client, monkeypatch):
    client.post("/api/admin/definitions/はな/next-year")
    _travel(monkeypatch, date(2027, 8, 1))  # 既定の編集対象は 2027 になる
    assert client.get("/api/admin/definitions/はな").json()["year"] == 2027

    entry = client.get("/api/admin/definitions/はな?year=2026").json()
    assert entry["year"] == 2026 and entry["years"] == [2026, 2027]
    doc = entry["doc"]
    doc["daily_homework"][0]["label"] = "おんどく（なおした）"
    r = client.put("/api/admin/definitions/はな?year=2026", json={"doc": doc, "revision": entry["revision"]})
    assert r.status_code == 200 and r.json()["year"] == 2026
    assert client.get("/api/admin/definitions/はな?year=2026").json()["doc"]["daily_homework"][0]["label"] == "おんどく（なおした）"
    # 2027 は巻き添えにならない
    assert client.get("/api/admin/definitions/はな?year=2027").json()["doc"]["daily_homework"][0]["label"] != "おんどく（なおした）"


def test_yearを書き換えて別の年に化けさせられない(client):
    entry = client.get("/api/admin/definitions/はな").json()
    doc = dict(entry["doc"], year=2030)
    r = client.put("/api/admin/definitions/はな", json={"doc": doc, "revision": entry["revision"]})
    assert r.status_code == 400 and "year" in r.json()["detail"]


def test_年を指定した削除はその年だけ消える(client):
    client.post("/api/admin/definitions/はな/next-year")
    assert client.delete("/api/admin/definitions/はな?year=2027").status_code == 200
    assert client.get("/api/admin/definitions/はな").json()["years"] == [2026]
    # 年を指定しなければ従来どおり全年
    client.post("/api/admin/definitions/はな/next-year")
    assert client.delete("/api/admin/definitions/はな").status_code == 200
    assert client.get("/api/admin/definitions/はな").status_code == 404


def test_一覧は今出ている年と全部の年を返す(client):
    client.post("/api/admin/definitions/はな/next-year")
    entry = client.get("/api/admin/definitions").json()["definitions"][0]
    assert entry["year"] == 2026 and entry["years"] == [2026, 2027]


# ---- 記録の掃除・インポート ----


def test_掃除は去年の記録を消さない(client):
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    daily_key = doc["daily_homework"][0]["key"]
    client.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-08-01", "item_key": daily_key, "status": "done"},
    )
    client.post("/api/admin/definitions/はな/next-year")
    r = client.post("/api/admin/definitions/はな/purge-orphans")
    assert r.status_code == 200
    assert r.json()["removed_check_rows"] == 0  # 去年のキーは去年の定義にある
    state = client.get("/api/summer/state?child=はな").json()
    assert any(day["statuses"] for day in state["history"])


def test_同じ子の別の年はインポートできキーは振り直される(client):
    exported = client.get("/api/admin/definitions/はな/export").json()
    assert client.post("/api/admin/definitions/import", json={"doc": exported}).status_code == 409
    other_year = dict(exported, year=2028)
    other_year["period"] = {
        "start": "2028-07-18",
        "end": "2028-08-31",
        "first_day_of_school": "2028-09-01",
    }
    other_year["school_start_items"] = [dict(i, due="2028-08-31") for i in exported["school_start_items"]]
    other_year["away"] = []
    r = client.post("/api/admin/definitions/import", json={"doc": other_year})
    assert r.status_code == 200 and r.json()["year"] == 2028
    assert _keys(exported) & _keys(r.json()["doc"]) == set()


def test_消した年を書き出したJSONから登録しなおすと記録も戻る(client):
    """年ごとの削除は記録を残す（画面も「記録は消えません」と約束している）.

    「同じ子の別の年が居る」だけでキーを振り直していたころは、その約束が取り込みの
    側で破れていた——のこした記録は古いキーのまま孤児になり、書き出しておいた JSON から
    登録しなおしても二度と結びつかない（復元した画面は真っさらのまま）。
    """
    exported = client.get("/api/admin/definitions/はな/export").json()
    client.post("/api/admin/definitions/はな/next-year")  # 同じ子の別の年が居る状態にする
    key = exported["habits"][0]["key"]
    client.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-08-01", "item_key": key, "status": "done"},
    )
    score = client.get("/api/summer/state?child=はな").json()["today_score"]["score"]
    assert score > 0  # 前提: 記録が点数に出ている

    assert client.request("DELETE", "/api/admin/definitions/はな?year=2026").status_code == 200
    r = client.post("/api/admin/definitions/import", json={"doc": exported})
    assert r.status_code == 200 and r.json()["year"] == 2026
    assert _keys(r.json()["doc"]) == _keys(exported), "登録しなおしでキーが振り直されている"
    state = client.get("/api/summer/state?child=はな").json()
    assert state["today_score"]["score"] == score, "のこしておいた記録が戻ってこない"


def test_きかんの外の記録の警告は他の年で誤爆しない(client, monkeypatch):
    doc = client.get("/api/admin/definitions/はな").json()["doc"]
    daily_key = doc["daily_homework"][0]["key"]
    client.post(
        "/api/summer/check/set",
        json={"child": "はな", "day": "2026-08-01", "item_key": daily_key, "status": "done"},
    )
    client.post("/api/admin/definitions/はな/next-year")
    _travel(monkeypatch, date(2027, 8, 1))
    next_doc = client.get("/api/admin/definitions/はな?year=2027").json()["doc"]
    r = client.post("/api/admin/definitions/はな/validate", json={"doc": next_doc})
    codes = [w["code"] for w in r.json()["warnings"]]
    assert "records_outside_period" not in codes

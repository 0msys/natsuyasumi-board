"""子ども向けエンドポイント（app/routers/summer.py）の結合テスト.

TestClient は app.main.create_app() を使い、DB はテンポラリ（app.db.DEFAULT_DB_PATH を
monkeypatch。ルーターは db_path を渡さず各サービスの既定 db_path が効くため、ここが注入点）。
「今日」は service.today_jst の monkeypatch で 2026-08-01（期間中・edges 窓外）に固定する。
child は全エンドポイント必須（無しは 422）。
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.admin import definition_store
from app.summer.kanji import ruby_reading
from app.main import create_app

TODAY = date(2026, 8, 1)
CHILD = "はな"


@pytest.fixture
def client(tmp_db, sample_doc, monkeypatch):
    definition_store.create_definition(sample_doc, db_path=tmp_db)
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", tmp_db)
    monkeypatch.setattr("app.summer.service.today_jst", lambda: TODAY)
    with TestClient(create_app()) as c:
        yield c


# ---- GET /api/summer/children ----


def test_children_一覧(client):
    r = client.get("/api/summer/children")
    assert r.status_code == 200
    children = r.json()["children"]
    assert len(children) == 1
    entry = children[0]
    assert entry["child"] == CHILD and entry["child_kana"] == "はな"
    assert entry["year"] == 2026 and entry["grade"] == "小2"
    assert entry["valid"] is True and entry["error"] is None
    assert entry["period"] == {
        "start": "2026-07-18",
        "end": "2026-08-31",
        "first_day_of_school": "2026-09-01",
    }


# ---- GET /api/summer/state ----


def test_state_の形(client):
    r = client.get("/api/summer/state", params={"child": CHILD})
    assert r.status_code == 200
    s = r.json()
    assert s["child"] == CHILD and s["child_kana"] == "はな" and s["grade"] == "小2"
    assert s["grade_level"] == 2
    assert s["today"] == "2026-08-01" and s["in_period"] is True
    assert len(s["habits"]) == 8  # はみがき3＋edges4＋ラジオ体操(range)1
    assert len(s["history"]) == 45  # 7/18〜8/31 の全日
    assert s["today_score"]["score"] == 0
    # 8/1 は edges 窓外・ラジオ体操期間外 → 窓つき習慣は window_active=False
    assert all(h["window_active"] is False for h in s["habits"] if h["window"] in ("edges", "range"))
    # 開きっぱなしの旧画面が undefined.rows で落ちないための互換スタブ（service.py の但し書き参照）
    assert s["card_guide"] is None
    radio = next(h for h in s["habits"] if h["key"] == "radio_taisou")
    assert radio["cancelable"] is True and radio["window"] == "range"
    assert radio["window_start"] == "2026-07-21" and radio["window_end"] == "2026-07-24"
    assert s["progress"] == {"days_elapsed": 15, "days_total": 45}
    assert s["away_today"] is None
    assert s["away"] == [{"start": "2026-08-07", "end": "2026-08-14", "label": "おばあちゃんのいえ"}]


def test_state_に学年別の画面文言が載る(client):
    """固定文言はサーバが学年ぶんだけ開いて state に載せる（フロントに配当表を持たせない）."""
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    ui = s["ui"]
    assert len(ui) > 50
    # サンプルは小2 ＝「今」「生」「活」まで習っている
    assert ui["today_checks_title"] == "今日《きょう》のチェック"
    assert ui["section_habits"] == "生活《せいかつ》"
    # 「期」は小3配当なので小2ではまだ かな
    assert ui["school_start_title"] == "しんがっきのじゅんび"


@pytest.mark.parametrize(
    ("grade", "expected"),
    [("小1", "しんがっきのじゅんび"), ("小3", "新学期《しんがっき》のじゅんび")],
)
def test_state_の画面文言は学年で漢字の量が変わる(tmp_db, sample_doc, monkeypatch, grade, expected):
    """定義の学年を変えると state の ui も変わる（「期」は小3配当）."""
    sample_doc["grade"] = grade
    definition_store.create_definition(sample_doc, db_path=tmp_db)
    monkeypatch.setattr("app.db.DEFAULT_DB_PATH", tmp_db)
    monkeypatch.setattr("app.summer.service.today_jst", lambda: TODAY)
    with TestClient(create_app()) as c:
        s = c.get("/api/summer/state", params={"child": CHILD}).json()
    assert s["ui"]["school_start_title"] == expected


def test_state_child必須(client):
    assert client.get("/api/summer/state").status_code == 422


def test_state_未登録childは503(client):
    assert client.get("/api/summer/state", params={"child": "しらないこ"}).status_code == 503


def test_state_history点数とstreaks(client):
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s["streaks"] == {"perfect_current": 0, "perfect_best": 0, "perfect_total": 0}
    assert all(h["score"] is None for h in s["history"])  # 全日未記録

    # きょう おんどくだけ done → history 当日の score は today_score と同値
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": "done"},
    )
    s2 = client.get("/api/summer/state", params={"child": CHILD}).json()
    h_today = next(h for h in s2["history"] if h["day"] == "2026-08-01")
    assert h_today["score"] == s2["today_score"]["score"] == 8

    # きのう（7/31・窓外は9項目）を全部 done → 満点スタンプ1。今日が未達でもまだ切らない
    for key in FULL_100_KEYS:
        client.post(
            "/api/summer/check/set",
            json={"child": CHILD, "day": "2026-07-31", "item_key": key, "status": "done"},
        )
    s3 = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert next(h for h in s3["history"] if h["day"] == "2026-07-31")["score"] == 100
    assert next(h for h in s3["history"] if h["day"] == "2026-07-30")["score"] is None  # 未記録は0に潰さない
    assert next(h for h in s3["history"] if h["day"] == "2026-08-02")["score"] is None  # 未来日
    assert s3["streaks"] == {"perfect_current": 1, "perfect_best": 1, "perfect_total": 1}


# ---- スペシャルチャレンジ（100点で解放される +25点ボーナス） ----

FULL_100_KEYS = (
    "hamigaki_asa", "hamigaki_hiru", "hamigaki_yoru",
    "ondoku", "nikki", "keisan", "kenban", "drill", "jishu",
)  # 8/1（窓外）で base=100 になる9項目


def _set_all_done(client, day, keys):
    for k in keys:
        client.post(
            "/api/summer/check/set", json={"child": CHILD, "day": day, "item_key": k, "status": "done"}
        )


def test_state_チャレンジ枠とscore_max(client):
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s["score_max"] == 200
    assert [c["key"] for c in s["special_challenges"]] == ["gakki", "otetsudai", "eigo", "tairyoku_ch"]
    assert all(c["status"] is None for c in s["special_challenges"])
    # base 0 → ロック（unlocked False）・total 0・ボーナス上限100
    ts = s["today_score"]
    assert ts["unlocked"] is False and ts["total"] == 0 and ts["bonus"] == 0 and ts["challenge_max"] == 100


# ---- ご褒美ランク（総積み上げ点数） ----


def test_state_ごほうびランク(client):
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    r = s["rewards"]
    assert r is not None
    assert [x["key"] for x in r["ranks"]] == ["c", "b", "a", "s"]
    assert [x["threshold"] for x in r["ranks"]] == [3600, 4500, 6750, 8100]  # avg×45
    assert all(x["prize"] is None and x["achieved"] is False for x in r["ranks"])
    assert r["max_total"] == 9000  # score_max(200) × days_total(45)＝ハードコードしない
    assert len(r["cumulative"]) == 45  # history と同順同長
    assert r["total"] == 0 and r["achieved_key"] is None and r["pace_key"] is None  # 記録なし

    # きのう（7/31）を base 100 に → cumulative の最終非None値 == total（今日の途中経過を含む位置）
    _set_all_done(client, "2026-07-31", FULL_100_KEYS)
    r2 = client.get("/api/summer/state", params={"child": CHILD}).json()["rewards"]
    non_none = [c for c in r2["cumulative"] if c is not None]
    assert non_none[-1] == r2["total"] == 100  # チャレンジ無しなので total=base=100


def test_challenge_100点未満はチェックしても加点されない(client):
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "gakki", "status": "done"},
    )
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s["today_score"]["unlocked"] is False
    assert s["today_score"]["total"] == s["today_score"]["score"]  # bonus 効かない


def test_challenge_100点で解放しボーナス加算_満点は100基準(client):
    # がっき を先にチェックしておく（100点前でも記録は残る）→ 宿題全部で base 100・解放
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "gakki", "status": "done"},
    )
    _set_all_done(client, "2026-08-01", FULL_100_KEYS)
    s1 = client.get("/api/summer/state", params={"child": CHILD}).json()
    ts = s1["today_score"]
    assert ts["score"] == 100 and ts["unlocked"] is True
    assert ts["bonus"] == 25 and ts["total"] == 125 and ts["challenge_done"] == 1
    # history 当日: total=125（グラフ数値）・score=100（満点Star判定）
    h = next(h for h in s1["history"] if h["day"] == "2026-08-01")
    assert h["score"] == 100 and h["total"] == 125

    # 残り3つで total 200・bonus 100
    for k in ("otetsudai", "eigo", "tairyoku_ch"):
        client.post(
            "/api/summer/check/set",
            json={"child": CHILD, "day": "2026-08-01", "item_key": k, "status": "done"},
        )
    s2 = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s2["today_score"]["total"] == 200 and s2["today_score"]["bonus"] == 100
    # 満点スタンプ・連続満点は base==100 基準のまま（total 200 でも満点は1日）
    assert s2["streaks"]["perfect_total"] == 1 and s2["streaks"]["perfect_current"] == 1


# ---- POST /api/summer/check/set ----


def test_check_set_3値と状態反映(client):
    r = client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": "done"},
    )
    assert r.status_code == 200 and r.json() == {"status": "done"}
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    ondoku = next(i for i in s["daily_homework"] if i["key"] == "ondoku")
    assert ondoku["status"] == "done" and ondoku["done_days"] == 1
    assert s["today_score"]["score"] == 8  # しゅくだい 50点×1/6 = 8.33 → 8

    r2 = client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": None},
    )
    assert r2.status_code == 200 and r2.json() == {"status": None}
    s2 = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert next(i for i in s2["daily_homework"] if i["key"] == "ondoku")["status"] is None


def test_check_set_過去日は許可(client):
    r = client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-07-20", "item_key": "hamigaki_asa", "status": "done"},
    )
    assert r.status_code == 200
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    h20 = next(h for h in s["history"] if h["day"] == "2026-07-20")
    assert h20["statuses"] == {"hamigaki_asa": "done"}


def test_check_set_中止はcancelable項目のみ(client):
    # ラジオ体操（cancelable・窓 7/21〜7/24）は過去日に「中止」を書ける
    r = client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-07-22", "item_key": "radio_taisou", "status": "cancelled"},
    )
    assert r.status_code == 200 and r.json() == {"status": "cancelled"}
    # cancelable でない項目は 400
    r2 = client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": "cancelled"},
    )
    assert r2.status_code == 400


@pytest.mark.parametrize(
    ("day", "item_key", "status"),
    [
        ("2026-08-02", "ondoku", "done"),  # 未来日
        ("2026-09-01", "ondoku", "done"),  # 期間外
        ("2026-08-01", "unknown_key", "done"),  # 未知 key
        ("2026-08-01", "ondoku", "maybe"),  # 不正 status
        ("08/01", "ondoku", "done"),  # 不正な日付形式
    ],
)
def test_check_set_400系(client, day, item_key, status):
    r = client.post(
        "/api/summer/check/set", json={"child": CHILD, "day": day, "item_key": item_key, "status": status}
    )
    assert r.status_code == 400


def test_check_set_child無しは422(client):
    r = client.post(
        "/api/summer/check/set", json={"day": "2026-08-01", "item_key": "ondoku", "status": "done"}
    )
    assert r.status_code == 422


# ---- POST /api/summer/check/meta ----


def test_meta_set_音読の本と計算カード(client):
    # done にしてから本のだいめいを記録 → state に meta が載る
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": "done"},
    )
    r = client.post(
        "/api/summer/check/meta",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "meta": {"book": "ながぐつをはいたねこ"}},
    )
    assert r.status_code == 200 and r.json() == {"meta": {"book": "ながぐつをはいたねこ"}}
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    ondoku = next(i for i in s["daily_homework"] if i["key"] == "ondoku")
    assert ondoku["meta"] == {"book": "ながぐつをはいたねこ"}
    assert [f["key"] for f in ondoku["meta_fields"]] == ["book"]

    # 計算カード: 種類とタイムをマージ保存（duration は秒で正規化）
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "status": "done"},
    )
    client.post(
        "/api/summer/check/meta",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "meta": {"calc_type": "tashizan"}},
    )
    r2 = client.post(
        "/api/summer/check/meta",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "meta": {"seconds": 80}},
    )
    assert r2.json() == {"meta": {"calc_type": "tashizan", "seconds": 80}}


def test_meta_set_done前は400(client):
    r = client.post(
        "/api/summer/check/meta",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "meta": {"book": "x"}},
    )
    assert r.status_code == 400  # まだ「やった」でない


def test_meta_set_不正系400(client):
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "status": "done"},
    )
    # 選べない choice 値
    assert (
        client.post(
            "/api/summer/check/meta",
            json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "meta": {"calc_type": "kakezan"}},
        ).status_code
        == 400
    )
    # メモを持たない項目（にっき）
    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "nikki", "status": "done"},
    )
    assert (
        client.post(
            "/api/summer/check/meta",
            json={"child": CHILD, "day": "2026-08-01", "item_key": "nikki", "meta": {"x": "y"}},
        ).status_code
        == 400
    )
    # 知らないフィールド
    assert (
        client.post(
            "/api/summer/check/meta",
            json={"child": CHILD, "day": "2026-08-01", "item_key": "keisan", "meta": {"nope": 1}},
        ).status_code
        == 400
    )


# ---- flag / count ----


def test_flag_toggle_往復(client):
    r = client.post("/api/summer/flag/toggle", json={"child": CHILD, "item_key": "enikki"})
    assert r.status_code == 200 and r.json() == {"value": 1, "done": True}
    r2 = client.post("/api/summer/flag/toggle", json={"child": CHILD, "item_key": "enikki"})
    assert r2.json() == {"value": 0, "done": False}


def test_count_set_クランプと達成(client):
    r = client.post("/api/summer/count/set", json={"child": CHILD, "item_key": "dokusho", "value": 3})
    assert r.json() == {"value": 3, "done": False}
    r2 = client.post("/api/summer/count/set", json={"child": CHILD, "item_key": "dokusho", "value": 5})
    assert r2.json() == {"value": 5, "done": True}
    r3 = client.post("/api/summer/count/set", json={"child": CHILD, "item_key": "dokusho", "value": 500})
    assert r3.json()["value"] == 99
    # カウント型はトグル不可・フラグ型は count/set 不可
    assert client.post("/api/summer/flag/toggle", json={"child": CHILD, "item_key": "dokusho"}).status_code == 400
    assert (
        client.post("/api/summer/count/set", json={"child": CHILD, "item_key": "enikki", "value": 1}).status_code
        == 400
    )


# ---- decision ----


def test_decision_任意宿題のskipとトグル拒否(client):
    r = client.post(
        "/api/summer/decision/set", json={"child": CHILD, "item_key": "jiyu_kenkyu", "decision": "skip"}
    )
    assert r.status_code == 200 and r.json() == {"decision": "skip"}
    assert client.post("/api/summer/flag/toggle", json={"child": CHILD, "item_key": "jiyu_kenkyu"}).status_code == 400
    # やる に戻せばトグルできる
    client.post("/api/summer/decision/set", json={"child": CHILD, "item_key": "jiyu_kenkyu", "decision": "do"})
    assert client.post("/api/summer/flag/toggle", json={"child": CHILD, "item_key": "jiyu_kenkyu"}).status_code == 200


def test_decision_必須宿題は不可(client):
    r = client.post("/api/summer/decision/set", json={"child": CHILD, "item_key": "enikki", "decision": "skip"})
    assert r.status_code == 400


def test_decision_選択宿題の全skip拒否(client):
    s = client.get("/api/summer/state", params={"child": CHILD}).json()
    options = s["choice_groups"][0]["options"]
    for o in options[:-1]:
        r = client.post(
            "/api/summer/decision/set", json={"child": CHILD, "item_key": o["key"], "decision": "skip"}
        )
        assert r.status_code == 200
    # 最後の1つを skip → 400（全部やらないは不可）
    last = options[-1]["key"]
    r = client.post("/api/summer/decision/set", json={"child": CHILD, "item_key": last, "decision": "skip"})
    assert r.status_code == 400
    assert "どれか1つ" in r.json()["detail"]
    # 1つ未定へ戻せば skip できる
    client.post(
        "/api/summer/decision/set", json={"child": CHILD, "item_key": options[0]["key"], "decision": None}
    )
    assert (
        client.post(
            "/api/summer/decision/set", json={"child": CHILD, "item_key": last, "decision": "skip"}
        ).status_code
        == 200
    )


# ---- todo-speech ----


def test_todo_speech(client):
    r = client.get("/api/summer/todo-speech", params={"child": CHILD})
    assert r.status_code == 200
    body = r.json()
    assert body["text"].startswith("はなさん。")
    assert body["day"] == "2026-08-01"
    # 宿題は集約行ではなく1項目ずつ残りに出る
    assert {"ondoku", "keisan"} <= {item["key"] for item in body["remaining"]}


def test_todo_speech_child必須(client):
    assert client.get("/api/summer/todo-speech").status_code == 422


# ---- comment（定型褒めメッセージ・決定的） ----


def test_comment_定型褒めは決定的(client):
    s0 = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s0["comment"]["band"] == "not_yet"  # 記録がまだ1件もない

    client.post(
        "/api/summer/check/set",
        json={"child": CHILD, "day": "2026-08-01", "item_key": "ondoku", "status": "done"},
    )
    s1 = client.get("/api/summer/state", params={"child": CHILD}).json()
    c = s1["comment"]
    assert c["score"] == 8 and c["band"] == "keep_going"
    # 小2 は low 帯の口調・小2の配当漢字（読みは全学年で同じ）
    assert "きょうは 8てんだよ。" in ruby_reading(c["text"])
    # 同じ日・同じ状態なら同じ文（リロードで変わらない）
    s2 = client.get("/api/summer/state", params={"child": CHILD}).json()
    assert s2["comment"] == c


# ---- アウトメディア視聴タイマー ----


def test_media_timer_start_state_pause(client):
    # 初期は経過0で停止
    s0 = client.get("/api/summer/media-timer/state", params={"child": CHILD}).json()
    assert s0["running"] is False and s0["elapsed_seconds"] == 0 and s0["limit_seconds"] == 7200
    assert s0["day"] == "2026-08-01" and s0["over_limit"] is False
    # 上限は表示文字列も一緒に配る（画面が「2時間」を持たない）。サンプルは小2
    assert s0["limit_label"] == "2時間《じかん》"
    # start → running
    s1 = client.post("/api/summer/media-timer/start", json={"child": CHILD}).json()
    assert s1["running"] is True and s1["resumed_at"] is not None
    # state も running を返す（server_now を含む）
    s2 = client.get("/api/summer/media-timer/state", params={"child": CHILD}).json()
    assert s2["running"] is True and s2["server_now"] >= s1["server_now"]
    # pause → 停止・accumulated は 0 以上・減っていない
    s3 = client.post("/api/summer/media-timer/pause", json={"child": CHILD}).json()
    assert s3["running"] is False and s3["resumed_at"] is None
    assert s3["accumulated_seconds"] >= 0 and s3["elapsed_seconds"] == s3["accumulated_seconds"]
    # 二重 pause で二重計上しない
    s4 = client.post("/api/summer/media-timer/pause", json={"child": CHILD}).json()
    assert s4["accumulated_seconds"] == s3["accumulated_seconds"]


def test_media_timer_上限は子どもの定義で決まる(client, tmp_db, sample_doc):
    other = dict(sample_doc, child="たろう", child_kana="たろう", media_timer={"limit_minutes": 45})
    definition_store.create_definition(other, db_path=tmp_db)
    hana = client.get("/api/summer/media-timer/state", params={"child": CHILD}).json()
    taro = client.get("/api/summer/media-timer/state", params={"child": "たろう"}).json()
    assert hana["limit_seconds"] == 7200 and hana["limit_label"] == "2時間《じかん》"
    assert taro["limit_seconds"] == 2700 and taro["limit_label"] == "45分《ふん》"

"""アウトメディア視聴タイマー（app/summer/service.py の media_timer_*）の特性化テスト.

`now`（epoch秒）を注入して時刻を固定し、start/pause の冪等性・累積・毎日0・上限超過・
「リセット経路が無い（accumulated は減らない）」を DB レベルで固定する。
上限は子どもごと（定義の media_timer.limit_minutes・定義が無ければ既定2時間）。
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app import db as app_db
from app.admin import definition_store
from app.summer import service, store
from tests.conftest import load_sample_doc

CHILD = "はな"
DAY = date(2026, 8, 1)
NEXT = date(2026, 8, 2)


def _seed(db_path: Path, child: str, *, limit_minutes: int | None = None, grade: str = "小2") -> None:
    """その子の定義を作る（このテストの関心はテレビタイマーの上限と学年だけ）."""
    doc = load_sample_doc()
    doc["child"] = child
    doc["child_kana"] = child
    doc["grade"] = grade
    if limit_minutes is None:
        doc.pop("media_timer", None)
    else:
        doc["media_timer"] = {"limit_minutes": limit_minutes}
    definition_store.create_definition(doc, db_path=db_path)


def test_初期状態は経過0で停止(tmp_db):
    s = service.media_timer_state(CHILD, today=DAY, now=1000, db_path=tmp_db)
    assert s["elapsed_seconds"] == 0
    assert s["running"] is False
    assert s["accumulated_seconds"] == 0
    assert s["resumed_at"] is None
    assert s["limit_seconds"] == 7200
    assert s["over_limit"] is False


def test_start後は経過がnowとともに増える(tmp_db):
    s = service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    assert s["running"] is True and s["resumed_at"] == 1000 and s["accumulated_seconds"] == 0
    assert s["elapsed_seconds"] == 0
    # 走行中は state を後の now で読むと経過が伸びる
    later = service.media_timer_state(CHILD, today=DAY, now=1600, db_path=tmp_db)
    assert later["elapsed_seconds"] == 600 and later["running"] is True


def test_pauseで走行区間がaccumulatedへ畳まれる(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    s = service.media_timer_pause(CHILD, today=DAY, now=1600, db_path=tmp_db)
    assert s["running"] is False and s["resumed_at"] is None
    assert s["accumulated_seconds"] == 600 and s["elapsed_seconds"] == 600
    # 停止後は now が進んでも経過は増えない
    assert service.media_timer_state(CHILD, today=DAY, now=9999, db_path=tmp_db)["elapsed_seconds"] == 600


def test_再開すると累積に上乗せされる(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    service.media_timer_pause(CHILD, today=DAY, now=1600, db_path=tmp_db)  # +600
    service.media_timer_start(CHILD, today=DAY, now=2000, db_path=tmp_db)  # 再開
    s = service.media_timer_state(CHILD, today=DAY, now=2100, db_path=tmp_db)
    assert s["elapsed_seconds"] == 700  # 600 + 100
    s2 = service.media_timer_pause(CHILD, today=DAY, now=2300, db_path=tmp_db)  # +300
    assert s2["accumulated_seconds"] == 900


def test_二重startは区間を伸ばさない(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    service.media_timer_start(CHILD, today=DAY, now=1500, db_path=tmp_db)  # 走行中の再start
    row = store.get_media_timer(CHILD, DAY.isoformat(), db_path=tmp_db)
    assert row.resumed_at == 1000  # 1500 に巻き戻していない
    assert service.media_timer_state(CHILD, today=DAY, now=1600, db_path=tmp_db)["elapsed_seconds"] == 600


def test_二重pauseは二重計上しない(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    service.media_timer_pause(CHILD, today=DAY, now=1600, db_path=tmp_db)  # +600
    s = service.media_timer_pause(CHILD, today=DAY, now=2000, db_path=tmp_db)  # 既に停止＝加算0
    assert s["accumulated_seconds"] == 600


def test_start前のpauseは何もしない(tmp_db):
    s = service.media_timer_pause(CHILD, today=DAY, now=1000, db_path=tmp_db)
    assert s["accumulated_seconds"] == 0 and s["running"] is False


def test_別の日は0から始まる(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    service.media_timer_pause(CHILD, today=DAY, now=5000, db_path=tmp_db)  # DAY は 4000 秒
    fresh = service.media_timer_state(CHILD, today=NEXT, now=6000, db_path=tmp_db)
    assert fresh["elapsed_seconds"] == 0 and fresh["accumulated_seconds"] == 0
    # DAY 側は保持されている（別 day 行）
    assert service.media_timer_state(CHILD, today=DAY, now=6000, db_path=tmp_db)["accumulated_seconds"] == 4000


def test_子ども別に独立してカウントする(tmp_db):
    service.media_timer_start("はな", today=DAY, now=1000, db_path=tmp_db)
    other = service.media_timer_state("たろう", today=DAY, now=2000, db_path=tmp_db)
    assert other["running"] is False and other["elapsed_seconds"] == 0


def test_2時間超過でover_limit(tmp_db):
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    under = service.media_timer_state(CHILD, today=DAY, now=1000 + 7199, db_path=tmp_db)
    assert under["over_limit"] is False
    over = service.media_timer_state(CHILD, today=DAY, now=1000 + 7200, db_path=tmp_db)
    assert over["over_limit"] is True and over["elapsed_seconds"] == 7200


# ---- 上限は子どもごと（定義の media_timer.limit_minutes） ----


def test_上限は定義から引く(tmp_db):
    _seed(tmp_db, CHILD, limit_minutes=30)
    s = service.media_timer_state(CHILD, today=DAY, now=1000, db_path=tmp_db)
    assert s["limit_seconds"] == 1800


@pytest.mark.parametrize("minutes", [30, 90, 240])
def test_over_limitは子どもごとの上限で切りかわる(tmp_db, minutes):
    _seed(tmp_db, CHILD, limit_minutes=minutes)
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    limit = minutes * 60
    under = service.media_timer_state(CHILD, today=DAY, now=1000 + limit - 1, db_path=tmp_db)
    over = service.media_timer_state(CHILD, today=DAY, now=1000 + limit, db_path=tmp_db)
    assert under["over_limit"] is False
    assert over["over_limit"] is True


def test_子どもごとに別々の上限を持てる(tmp_db):
    _seed(tmp_db, "はな", limit_minutes=30)
    _seed(tmp_db, "たろう", limit_minutes=90)
    assert service.media_timer_state("はな", today=DAY, now=1000, db_path=tmp_db)["limit_seconds"] == 1800
    assert service.media_timer_state("たろう", today=DAY, now=1000, db_path=tmp_db)["limit_seconds"] == 5400


def test_定義に区画が無ければ既定2時間(tmp_db):
    _seed(tmp_db, CHILD, limit_minutes=None)
    assert service.media_timer_state(CHILD, today=DAY, now=1000, db_path=tmp_db)["limit_seconds"] == 7200


def test_定義が無い子でもタイマーは動く_既定2時間(tmp_db):
    # 採点と独立の機能なので、定義が引けなくても止めない（既定に倒す）
    s = service.media_timer_start("だれか", today=DAY, now=1000, db_path=tmp_db)
    assert s["limit_seconds"] == 7200 and s["running"] is True


# 壊れかたによって parse_definition が投げる例外は SummerDefinitionError とは限らない
# （year が数字でない・options が配列でない等は素の ValueError / TypeError が出る）。
# タイマーはどの壊れかたでも既定に倒して動き続ける＝ここが 500 になってはいけない。
_BROKEN_DOCS = {
    "JSONが壊れている": "{broken json",
    "必須キーが無い": json.dumps({"child": "こわれたこ"}),
    "yearが数字でない": json.dumps(
        {
            "child": "こわれたこ",
            "year": "にせんにじゅうろく",  # ここで素の ValueError が出る
            "grade": "小2",
            "period": {"start": "2026-07-18", "end": "2026-08-31", "first_day_of_school": "2026-09-01"},
        }
    ),
    "choiceのoptionsが配列でない": json.dumps(
        {
            "child": "こわれたこ",
            "year": 2026,
            "grade": "小2",
            "period": {"start": "2026-07-18", "end": "2026-08-31", "first_day_of_school": "2026-09-01"},
            "choice_homework": [{"key": "g", "label": "えらぶ", "options": 3}],  # 素の TypeError
        }
    ),
}


@pytest.mark.parametrize("doc", _BROKEN_DOCS.values(), ids=list(_BROKEN_DOCS))
def test_定義が壊れていてもタイマーは動く_既定2時間(tmp_db, doc):
    # create_definition は検証済みしか書かないため、壊れ行は SQL 直挿入で再現する
    with app_db.connect(tmp_db) as conn:
        conn.execute(
            "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, 0)",
            ("こわれたこ", 2026, doc),
        )
    started = service.media_timer_start("こわれたこ", today=DAY, now=1000, db_path=tmp_db)
    state = service.media_timer_state("こわれたこ", today=DAY, now=1600, db_path=tmp_db)
    paused = service.media_timer_pause("こわれたこ", today=DAY, now=1600, db_path=tmp_db)
    assert started["running"] is True
    assert state["elapsed_seconds"] == 600  # 計測そのものは通常どおり動く
    assert paused["accumulated_seconds"] == 600
    for s in (started, state, paused):
        assert s["limit_seconds"] == 7200 and s["limit_label"] == "2じかん"


def test_定義破損以外の障害は既定に倒さず外へ出す(tmp_db, monkeypatch):
    """DB 障害などを既定 2時間にすり替えない（上限が効いていないのに正常に見えるのを防ぐ）."""

    def boom(*a, **kw):
        raise RuntimeError("DB が読めない")

    monkeypatch.setattr("app.summer.service.load_definition", boom)
    with pytest.raises(RuntimeError):
        service.media_timer_state(CHILD, today=DAY, now=1000, db_path=tmp_db)


def test_start_pauseも同じ上限を返す(tmp_db):
    _seed(tmp_db, CHILD, limit_minutes=45)
    started = service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    paused = service.media_timer_pause(CHILD, today=DAY, now=1100, db_path=tmp_db)
    assert started["limit_seconds"] == paused["limit_seconds"] == 2700


@pytest.mark.parametrize(
    ("minutes", "grade", "label"),
    [
        (120, "小2", "2時間《じかん》"),
        (120, "小1", "2じかん"),  # 小1は「時間」がまだ配当外＝かなへ畳む
        (90, "小2", "1時間《じかん》30分《ぷん》"),  # さんじゅっぷん（ふん ではない）
        (90, "小1", "1じかん30ぷん"),  # 小1は漢字ごと畳むので読みがそのまま本文になる
        (45, "小2", "45分《ふん》"),
        (1440, "小2", "24時間《じかん》"),
    ],
)
def test_上限の表示文字列は学年で開く(tmp_db, minutes, grade, label):
    _seed(tmp_db, CHILD, limit_minutes=minutes, grade=grade)
    s = service.media_timer_state(CHILD, today=DAY, now=1000, db_path=tmp_db)
    assert s["limit_label"] == label


def test_リセット経路が無い_accumulatedは減らない(tmp_db):
    # start/pause を何度繰り返しても accumulated は単調増加のみ（ゼロ書き戻しのコードパスが無い）
    service.media_timer_start(CHILD, today=DAY, now=1000, db_path=tmp_db)
    service.media_timer_pause(CHILD, today=DAY, now=1100, db_path=tmp_db)  # 100
    prev = store.get_media_timer(CHILD, DAY.isoformat(), db_path=tmp_db).accumulated_seconds
    for t in (1200, 1300, 1400):
        service.media_timer_start(CHILD, today=DAY, now=t, db_path=tmp_db)
        service.media_timer_pause(CHILD, today=DAY, now=t + 10, db_path=tmp_db)
        cur = store.get_media_timer(CHILD, DAY.isoformat(), db_path=tmp_db).accumulated_seconds
        assert cur >= prev  # 減らない
        prev = cur
    assert prev == 130  # 100 + 10*3


def test_stateのui文言に生の波括弧を残さない(tmp_db):
    """更新前に開いたままの端末に「{limit}」を見せないための恒常検査.

    子ども画面は60秒ごとに state を取り直すので、更新直後は「古い JS が新しい state を
    受け取る」時間帯が必ずできる。古い JS は {limit} を知らないので、サーバ側で実値に
    しておかないと画面に生の波括弧が出る（card_guide に互換スタブを置いたのと同じ事情）。
    """
    _seed(tmp_db, CHILD, limit_minutes=90, grade="小2")
    ui = service.build_state(CHILD, today=DAY, db_path=tmp_db)["ui"]
    assert "1時間《じかん》30分《ぷん》" in ui["timer_remaining"]
    assert "1時間《じかん》30分《ぷん》" in ui["timer_over_limit"]
    # {left} は走行中の経過から画面が埋めるので残っていてよい。{limit} だけは残さない。
    残り = [k for k, v in ui.items() if "{limit}" in v]
    assert not 残り, f"ui に {{limit}} が残っている: {残り}"


def test_ui文言の上限は子どもごとに変わる(tmp_db):
    _seed(tmp_db, CHILD, limit_minutes=30, grade="小2")
    _seed(tmp_db, "そら", limit_minutes=180, grade="小2")
    hana = service.build_state(CHILD, today=DAY, db_path=tmp_db)["ui"]
    sora = service.build_state("そら", today=DAY, db_path=tmp_db)["ui"]
    assert "30分《ぷん》" in hana["timer_remaining"]
    assert "3時間《じかん》" in sora["timer_remaining"]

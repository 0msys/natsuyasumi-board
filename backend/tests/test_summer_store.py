"""チェック記録の永続化層（app/summer/store.py）の往復テスト.

テンポラリ DB に ensure_schema を適用し、3値遷移（done→not_done→None=行削除）・
UNIQUE 冪等・meta の保存/消去・decision の skip リセットを固定する。
"""

from __future__ import annotations

import json
from datetime import date

from app.summer import store

DAY = date(2026, 7, 20)


# ---- 日次3値記録 ----


def test_check_3値遷移と行削除(tmp_db):
    store.set_check_status("はな", DAY, "ondoku", "done", db_path=tmp_db)
    assert store.list_checks("はな", DAY, DAY, db_path=tmp_db) == {"2026-07-20": {"ondoku": "done"}}

    store.set_check_status("はな", DAY, "ondoku", "not_done", db_path=tmp_db)
    assert store.list_checks("はな", DAY, DAY, db_path=tmp_db)["2026-07-20"]["ondoku"] == "not_done"

    store.set_check_status("はな", DAY, "ondoku", None, db_path=tmp_db)  # 未記入へ戻す
    assert store.list_checks("はな", DAY, DAY, db_path=tmp_db) == {}


def test_check_同キー上書きは1行のまま(tmp_db):
    for status in ("done", "done", "not_done"):
        store.set_check_status("はな", DAY, "nikki", status, db_path=tmp_db)
    checks = store.list_checks("はな", DAY, DAY, db_path=tmp_db)
    assert checks == {"2026-07-20": {"nikki": "not_done"}}


def test_check_期間絞り込みと子ども分離(tmp_db):
    store.set_check_status("はな", date(2026, 7, 18), "ondoku", "done", db_path=tmp_db)
    store.set_check_status("はな", date(2026, 7, 25), "ondoku", "done", db_path=tmp_db)
    store.set_check_status("たろう", date(2026, 7, 18), "ondoku", "done", db_path=tmp_db)
    checks = store.list_checks("はな", date(2026, 7, 18), date(2026, 7, 20), db_path=tmp_db)
    assert list(checks) == ["2026-07-18"]


def test_meta_保存と取得とlist(tmp_db):
    store.set_check_status("はな", DAY, "keisan", "done", db_path=tmp_db)
    store.set_check_meta(
        "はな", DAY, "keisan", json.dumps({"calc_type": "tashizan", "seconds": 80}), db_path=tmp_db
    )
    row = store.get_check("はな", DAY, "keisan", db_path=tmp_db)
    assert row is not None and row.status == "done"
    assert row.meta == {"calc_type": "tashizan", "seconds": 80}
    assert store.list_meta("はな", DAY, DAY, db_path=tmp_db) == {
        "2026-07-20": {"keisan": {"calc_type": "tashizan", "seconds": 80}}
    }


def test_meta_notdoneでmetaが消える(tmp_db):
    store.set_check_status("はな", DAY, "ondoku", "done", db_path=tmp_db)
    store.set_check_meta("はな", DAY, "ondoku", json.dumps({"book": "ながぐつをはいたねこ"}), db_path=tmp_db)
    assert store.get_check("はな", DAY, "ondoku", db_path=tmp_db).meta == {"book": "ながぐつをはいたねこ"}
    # 「やらなかった」へ変えると meta は消える（list_meta にも出ない）
    store.set_check_status("はな", DAY, "ondoku", "not_done", db_path=tmp_db)
    assert store.get_check("はな", DAY, "ondoku", db_path=tmp_db).meta == {}
    assert store.list_meta("はな", DAY, DAY, db_path=tmp_db) == {}


def test_meta_壊れJSONは空dictに縮退(tmp_db):
    store.set_check_status("はな", DAY, "ondoku", "done", db_path=tmp_db)
    store.set_check_meta("はな", DAY, "ondoku", "{broken", db_path=tmp_db)
    assert store.get_check("はな", DAY, "ondoku", db_path=tmp_db).meta == {}
    assert store.list_meta("はな", DAY, DAY, db_path=tmp_db) == {}


def test_check_行が無ければNone(tmp_db):
    assert store.get_check("はな", DAY, "ondoku", db_path=tmp_db) is None


# ---- flags（value / decision） ----


def test_flag_value_upsert(tmp_db):
    assert store.set_flag_value("はな", "enikki", 1, db_path=tmp_db) == 1
    store.set_flag_value("はな", "dokusho", 3, db_path=tmp_db)
    flags = store.list_flags("はな", db_path=tmp_db)
    assert flags["enikki"].value == 1 and flags["enikki"].decision is None
    assert flags["dokusho"].value == 3
    store.set_flag_value("はな", "enikki", 0, db_path=tmp_db)
    assert store.list_flags("はな", db_path=tmp_db)["enikki"].value == 0


def test_decision_skipはvalueを0に戻す(tmp_db):
    store.set_flag_value("はな", "jiyu_kenkyu", 1, db_path=tmp_db)
    store.set_decision("はな", "jiyu_kenkyu", "skip", db_path=tmp_db)
    st = store.list_flags("はな", db_path=tmp_db)["jiyu_kenkyu"]
    assert st.decision == "skip" and st.value == 0


def test_decision_doはvalueを保持(tmp_db):
    store.set_flag_value("はな", "jiyu_kenkyu", 1, db_path=tmp_db)
    store.set_decision("はな", "jiyu_kenkyu", "do", db_path=tmp_db)
    st = store.list_flags("はな", db_path=tmp_db)["jiyu_kenkyu"]
    assert st.decision == "do" and st.value == 1


def test_decision_未定へ戻せる(tmp_db):
    store.set_decision("はな", "tairyoku", "skip", db_path=tmp_db)
    store.set_decision("はな", "tairyoku", None, db_path=tmp_db)
    assert store.list_flags("はな", db_path=tmp_db)["tairyoku"].decision is None


def test_flags_子ども分離(tmp_db):
    store.set_flag_value("はな", "enikki", 1, db_path=tmp_db)
    assert store.list_flags("たろう", db_path=tmp_db) == {}

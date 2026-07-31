"""定義の保存・履歴・改名・利用状況（app/admin/definition_store.py）のテスト.

create→get→save のラウンドトリップ・楽観ロック 409・履歴 prune（HISTORY_KEEP=10）・
assign_keys の自動採番・rename_child の一括更新・usage・purge_orphans を固定する。
"""

from __future__ import annotations

import json
from datetime import date

import pytest

from app import db as app_db
from app.admin import definition_store
from app.admin.definition_store import DefinitionStoreError, assign_keys
from app.summer import store
from app.summer.definition import parse_definition
from tests.conftest import CHILD, load_sample_doc

DAY = date(2026, 7, 20)


# ---- create → get → save のラウンドトリップ ----


def test_create_get_ラウンドトリップ(tmp_db, sample_doc):
    created = definition_store.create_definition(sample_doc, db_path=tmp_db)
    assert created["child"] == CHILD and created["year"] == 2026 and created["revision"] == 1

    got = definition_store.get_document(CHILD, db_path=tmp_db)
    assert got is not None
    assert got["child"] == CHILD and got["year"] == 2026 and got["revision"] == 1
    # 往復後も dataclass として等価（キー採番済みサンプルは変化しない）
    assert parse_definition(got["doc"]) == parse_definition(load_sample_doc())


def test_create_同名は409(seeded_db, sample_doc):
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.create_definition(sample_doc, db_path=seeded_db)
    assert e.value.status_code == 409


def test_create_不正docは422(tmp_db, sample_doc):
    sample_doc["grade"] = "小7"
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.create_definition(sample_doc, db_path=tmp_db)
    assert e.value.status_code == 422


def test_get_未登録はNone(tmp_db):
    assert definition_store.get_document("しらないこ", db_path=tmp_db) is None


def test_save_revisionが増える(seeded_db):
    doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
    doc["habits"][0]["label"] = "はみがき（あさごはんのあと）"
    saved = definition_store.save_document(CHILD, doc, expected_revision=1, db_path=seeded_db)
    assert saved["revision"] == 2
    got = definition_store.get_document(CHILD, db_path=seeded_db)
    assert got["revision"] == 2
    assert got["doc"]["habits"][0]["label"] == "はみがき（あさごはんのあと）"


def test_save_楽観ロック_古いrevisionは409(seeded_db):
    doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
    definition_store.save_document(CHILD, doc, expected_revision=1, db_path=seeded_db)  # → revision 2
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.save_document(CHILD, dict(doc), expected_revision=1, db_path=seeded_db)
    assert e.value.status_code == 409
    # 失敗した保存で revision は動かない
    assert definition_store.get_document(CHILD, db_path=seeded_db)["revision"] == 2


def test_save_childとyearは変更不可(seeded_db):
    doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
    renamed = dict(doc, child="べつのこ")
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.save_document(CHILD, renamed, expected_revision=1, db_path=seeded_db)
    assert e.value.status_code == 400
    reyear = dict(doc, year=2027)
    with pytest.raises(DefinitionStoreError) as e2:
        definition_store.save_document(CHILD, reyear, expected_revision=1, db_path=seeded_db)
    assert e2.value.status_code == 400


def test_save_未登録childは404(tmp_db, sample_doc):
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.save_document(CHILD, sample_doc, expected_revision=1, db_path=tmp_db)
    assert e.value.status_code == 404


def test_save_不正docは422で保存されない(seeded_db):
    doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
    doc["period"]["start"] = "2026-12-31"  # start > end
    with pytest.raises(DefinitionStoreError) as e:
        definition_store.save_document(CHILD, doc, expected_revision=1, db_path=seeded_db)
    assert e.value.status_code == 422
    assert definition_store.get_document(CHILD, db_path=seeded_db)["revision"] == 1


# ---- 履歴の prune（HISTORY_KEEP=10） ----


def test_履歴はHISTORY_KEEP世代でprune(seeded_db):
    assert definition_store.HISTORY_KEEP == 10
    revision = 1
    for i in range(12):
        doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
        doc["habits"][0]["label"] = f"はみがき（あさ）v{i}"
        saved = definition_store.save_document(CHILD, doc, expected_revision=revision, db_path=seeded_db)
        revision = saved["revision"]
    assert revision == 13
    with app_db.connect(seeded_db) as conn:
        rows = conn.execute(
            "SELECT revision FROM summer_definition_history WHERE child = ? ORDER BY revision",
            (CHILD,),
        ).fetchall()
    # 12回保存で履歴は 1〜12 の12世代 → 直近10世代（3〜12）だけ残る
    assert [r[0] for r in rows] == list(range(3, 13))


# ---- assign_keys（key:null への自動採番） ----


def test_assign_keys_接頭辞つきで採番し既存キーと衝突しない():
    doc = {
        "habits": [{"label": "しんき"}, {"key": "hamigaki_asa", "label": "きぞん"}],
        "daily_homework": [{"label": "しんき", "meta": [{"type": "text", "label": "めも"}]}],
        "practice_homework": [{"label": "しんき", "key": None}],
        "special_challenges": [{"label": "しんき", "key": ""}],
        "one_shot_homework": [{"label": "しんき"}],
        "school_start_items": [{"label": "しんき"}],
        "rewards": [{"label": "しんき", "avg": 80}],
        "choice_homework": [
            {"label": "しんき", "options": [{"label": "しんき"}, {"key": "o_keep", "label": "きぞん"}]}
        ],
    }
    assign_keys(doc)

    prefix_by_section = {
        "habits": "h_",
        "daily_homework": "dh_",
        "practice_homework": "ph_",
        "special_challenges": "sc_",
        "one_shot_homework": "os_",
        "school_start_items": "ss_",
        "rewards": "r_",
    }
    all_keys: list[str] = []
    for section, prefix in prefix_by_section.items():
        for item in doc[section]:
            assert item["key"], f"{section} に未採番の項目が残っている"
            all_keys.append(item["key"])
            if item["label"] == "しんき":  # 新規採番分は 接頭辞＋6桁英数
                assert item["key"].startswith(prefix)
                assert len(item["key"]) == len(prefix) + 6
    # 既存キーは変更されない
    assert doc["habits"][1]["key"] == "hamigaki_asa"
    assert doc["choice_homework"][0]["options"][1]["key"] == "o_keep"
    # meta / choice グループ・オプションにも採番される
    assert doc["daily_homework"][0]["meta"][0]["key"].startswith("m_")
    assert doc["choice_homework"][0]["key"].startswith("cg_")
    assert doc["choice_homework"][0]["options"][0]["key"].startswith("o_")
    # 全キー一意
    all_keys.append(doc["choice_homework"][0]["key"])
    all_keys.extend(o["key"] for o in doc["choice_homework"][0]["options"])
    all_keys.append(doc["daily_homework"][0]["meta"][0]["key"])
    assert len(all_keys) == len(set(all_keys))


def test_assign_keys_採番済みdocは不変(sample_doc):
    before = json.dumps(sample_doc, ensure_ascii=False, sort_keys=True)
    assign_keys(sample_doc)
    assert json.dumps(sample_doc, ensure_ascii=False, sort_keys=True) == before


def test_assign_keys_meta_choiceの選択肢キーも採番する():
    # メモ欄 choice の選択肢キーは保存値になる。key 無しで放置すると衝突・str(None) 化するため
    # サーバ採番の対象に含める（管理画面エージェントが検出した実バグの回帰テスト）。
    doc = {
        "daily_homework": [
            {
                "label": "けいさん",
                "meta": [
                    {
                        "type": "choice",
                        "label": "しゅるい",
                        "options": [{"label": "たしざん"}, {"key": "mo_keep", "label": "ひきざん"}],
                    }
                ],
            }
        ],
    }
    assign_keys(doc)
    options = doc["daily_homework"][0]["meta"][0]["options"]
    assert options[0]["key"].startswith("mo_") and len(options[0]["key"]) == len("mo_") + 6
    assert options[1]["key"] == "mo_keep"  # 既存キーは不変
    assert options[0]["key"] != options[1]["key"]


# ---- rename_child（定義＋記録3テーブルの一括更新） ----


def test_rename_定義と記録が一括で移る(seeded_db):
    # 履歴も作っておく（rename は履歴テーブルも更新する）
    doc = definition_store.get_document(CHILD, db_path=seeded_db)["doc"]
    definition_store.save_document(CHILD, doc, expected_revision=1, db_path=seeded_db)
    # 記録3テーブルへ旧名で書く
    store.set_check_status(CHILD, DAY, "ondoku", "done", db_path=seeded_db)
    store.set_flag_value(CHILD, "enikki", 1, db_path=seeded_db)
    store.start_media_timer(CHILD, DAY, 1000, db_path=seeded_db)

    definition_store.rename_child(CHILD, "ゆき", db_path=seeded_db)

    assert definition_store.get_document(CHILD, db_path=seeded_db) is None
    got = definition_store.get_document("ゆき", db_path=seeded_db)
    assert got is not None and got["doc"]["child"] == "ゆき"  # doc 内の child も更新
    assert store.list_checks("ゆき", DAY, DAY, db_path=seeded_db) == {"2026-07-20": {"ondoku": "done"}}
    assert store.list_checks(CHILD, DAY, DAY, db_path=seeded_db) == {}
    assert store.list_flags("ゆき", db_path=seeded_db)["enikki"].value == 1
    assert store.list_flags(CHILD, db_path=seeded_db) == {}
    assert store.get_media_timer("ゆき", DAY, db_path=seeded_db) is not None
    assert store.get_media_timer(CHILD, DAY, db_path=seeded_db) is None
    with app_db.connect(seeded_db) as conn:
        n_old = conn.execute(
            "SELECT COUNT(*) FROM summer_definition_history WHERE child = ?", (CHILD,)
        ).fetchone()[0]
        n_new = conn.execute(
            "SELECT COUNT(*) FROM summer_definition_history WHERE child = ?", ("ゆき",)
        ).fetchone()[0]
    assert n_old == 0 and n_new == 1


def test_rename_エラー系(seeded_db, sample_doc):
    with pytest.raises(DefinitionStoreError) as e404:
        definition_store.rename_child("しらないこ", "ゆき", db_path=seeded_db)
    assert e404.value.status_code == 404
    with pytest.raises(DefinitionStoreError) as e400:
        definition_store.rename_child(CHILD, "  ", db_path=seeded_db)
    assert e400.value.status_code == 400
    # 既存名への rename は 409
    other = dict(sample_doc, child="ゆき")
    definition_store.create_definition(other, db_path=seeded_db)
    with pytest.raises(DefinitionStoreError) as e409:
        definition_store.rename_child(CHILD, "ゆき", db_path=seeded_db)
    assert e409.value.status_code == 409
    # 同名 rename は no-op
    definition_store.rename_child(CHILD, CHILD, db_path=seeded_db)
    assert definition_store.get_document(CHILD, db_path=seeded_db) is not None


# ---- usage / record_day_range / purge_orphans ----


def test_usage_記録件数を数える(seeded_db):
    store.set_check_status(CHILD, date(2026, 7, 20), "ondoku", "done", db_path=seeded_db)
    store.set_check_status(CHILD, date(2026, 7, 21), "ondoku", "not_done", db_path=seeded_db)
    store.set_flag_value(CHILD, "enikki", 1, db_path=seeded_db)
    store.set_decision(CHILD, "jiyu_kenkyu", "skip", db_path=seeded_db)  # value 0 でも decision あり
    store.set_flag_value(CHILD, "dokusho", 0, db_path=seeded_db)  # value 0・decision 無し → 数えない
    assert definition_store.usage(CHILD, db_path=seeded_db) == {
        "ondoku": 2,
        "enikki": 1,
        "jiyu_kenkyu": 1,
    }


def test_record_day_range(seeded_db):
    assert definition_store.record_day_range(CHILD, db_path=seeded_db) is None
    store.set_check_status(CHILD, date(2026, 7, 20), "ondoku", "done", db_path=seeded_db)
    store.set_check_status(CHILD, date(2026, 8, 5), "nikki", "done", db_path=seeded_db)
    assert definition_store.record_day_range(CHILD, db_path=seeded_db) == ("2026-07-20", "2026-08-05")


def test_purge_orphans_定義に無いキーだけ消す(seeded_db):
    # 正規の記録
    store.set_check_status(CHILD, DAY, "ondoku", "done", db_path=seeded_db)
    store.set_flag_value(CHILD, "enikki", 1, db_path=seeded_db)
    # 定義に無い孤児キー
    store.set_check_status(CHILD, DAY, "ghost_daily", "done", db_path=seeded_db)
    store.set_check_status(CHILD, date(2026, 7, 21), "ghost_daily", "done", db_path=seeded_db)
    store.set_flag_value(CHILD, "ghost_flag", 1, db_path=seeded_db)

    result = definition_store.purge_orphans(CHILD, db_path=seeded_db)
    assert result == {
        "orphan_daily_keys": 1,
        "orphan_flag_keys": 1,
        "removed_check_rows": 2,
        "removed_flag_rows": 1,
    }
    # 正規の記録は残る
    assert store.list_checks(CHILD, DAY, DAY, db_path=seeded_db) == {"2026-07-20": {"ondoku": "done"}}
    assert "enikki" in store.list_flags(CHILD, db_path=seeded_db)
    assert "ghost_flag" not in store.list_flags(CHILD, db_path=seeded_db)

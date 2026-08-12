"""全件収集バリデータ（app/admin/validate.py）のテスト.

核心の恒常検査: parse_definition（最終ゲート）と validate_document（保存前のドライラン）が
同じ doc を同じように受け入れ／拒む（乖離ドリフト防止・両向き）。
  parse 拒否 → validate も errors  … 保存できたのに子ども画面が 503、を防ぐ
  parse 受理 → validate も errors なし … 取り込めたのに保存できない、を防ぐ
加えて kanji_grade / mid_period_add / rewards_unreachable / delete_with_records /
records_outside_period の warning を固定する。
"""

from __future__ import annotations

import copy
from datetime import date

import pytest

from app.admin.definition_store import assign_keys
from app.admin.validate import validate_document
from app.summer.definition import (
    EDGES_WINDOW_DAYS_MAX,
    SummerDefinitionError,
    parse_definition,
)
from tests.conftest import hostile_docs, load_sample_doc


def _radio(doc: dict) -> dict:
    return next(h for h in doc["habits"] if h["key"] == "radio_taisou")


def _mutate_child欠落(doc):
    del doc["child"]


def _mutate_year欠落(doc):
    del doc["year"]


def _mutate_grade不正(doc):
    doc["grade"] = "小7"


def _mutate_grade空(doc):
    doc["grade"] = ""


def _mutate_period欠落(doc):
    del doc["period"]


def _mutate_日付不正(doc):
    doc["period"]["start"] = "7月18日"


def _mutate_period順序(doc):
    doc["period"]["start"] = "2026-09-30"


def _mutate_window不正(doc):
    doc["habits"][3]["window"] = "sometimes"


def _mutate_range順序(doc):
    _radio(doc)["window_start"] = "2026-07-25"  # window_end(7/24) より後


def _mutate_range開始欠落(doc):
    del _radio(doc)["window_start"]


def _mutate_meta_choice_options欠落(doc):
    keisan = next(i for i in doc["daily_homework"] if i["key"] == "keisan")
    keisan["meta"][0]["options"] = []


def _mutate_meta_type不正(doc):
    keisan = next(i for i in doc["daily_homework"] if i["key"] == "keisan")
    keisan["meta"][0]["type"] = "number"


def _mutate_rewards_avg0(doc):
    doc["rewards"][0]["avg"] = 0


def _mutate_rewards_avg非int(doc):
    doc["rewards"][0]["avg"] = "たくさん"


def _mutate_rewards非昇順(doc):
    doc["rewards"][0]["avg"], doc["rewards"][1]["avg"] = 100, 80


def _mutate_min_required超過(doc):
    doc["choice_homework"][0]["min_required"] = 7  # 選択肢は6個


def _mutate_min_required0(doc):
    doc["choice_homework"][0]["min_required"] = 0


def _mutate_count_target欠落(doc):
    dokusho = next(i for i in doc["one_shot_homework"] if i["key"] == "dokusho")
    del dokusho["target"]


def _mutate_one_shot_type不正(doc):
    doc["one_shot_homework"][0]["type"] = "many"


def _mutate_voice_speaker不正(doc):
    doc["voice"] = {"speaker": -1}


def _mutate_voice_マップでない(doc):
    doc["voice"] = [3]


def _mutate_media_timer_マップでない(doc):
    doc["media_timer"] = [120]


def _mutate_media_limit_0(doc):
    doc["media_timer"] = {"limit_minutes": 0}


def _mutate_media_limit_非int(doc):
    doc["media_timer"] = {"limit_minutes": "2時間"}


def _mutate_media_limit_1日超過(doc):
    doc["media_timer"] = {"limit_minutes": 1441}


def _mutate_key重複_daily空間(doc):
    doc["habits"][0]["key"] = "ondoku"


def _mutate_key重複_flags空間(doc):
    doc["school_start_items"][0]["key"] = "enikki"


PARSE_REJECT_CASES = [
    _mutate_child欠落,
    _mutate_year欠落,
    _mutate_grade不正,
    _mutate_grade空,
    _mutate_period欠落,
    _mutate_日付不正,
    _mutate_period順序,
    _mutate_window不正,
    _mutate_range順序,
    _mutate_range開始欠落,
    _mutate_meta_choice_options欠落,
    _mutate_meta_type不正,
    _mutate_rewards_avg0,
    _mutate_rewards_avg非int,
    _mutate_rewards非昇順,
    _mutate_min_required超過,
    _mutate_min_required0,
    _mutate_count_target欠落,
    _mutate_one_shot_type不正,
    _mutate_voice_speaker不正,
    _mutate_voice_マップでない,
    _mutate_media_timer_マップでない,
    _mutate_media_limit_0,
    _mutate_media_limit_非int,
    _mutate_media_limit_1日超過,
    _mutate_key重複_daily空間,
    _mutate_key重複_flags空間,
]


@pytest.mark.parametrize("mutate", PARSE_REJECT_CASES, ids=lambda f: f.__name__.removeprefix("_mutate_"))
def test_parseが拒む不正docはvalidateでもerrors非空(mutate):
    doc = load_sample_doc()
    mutate(doc)
    with pytest.raises(SummerDefinitionError):
        parse_definition(copy.deepcopy(doc))  # parse 側の破壊なしで両者に同じ doc を渡す
    result = validate_document(doc)
    assert result["ok"] is False
    assert result["errors"], "parse_definition が拒む doc を validate_document が素通しした"
    for err in result["errors"]:
        assert set(err) == {"path", "code", "message"}


def test_正常docはokでerrorsもwarningsも空(sample_doc):
    result = validate_document(sample_doc)
    assert result == {"ok": True, "errors": [], "warnings": []}


def test_マップでないdocはok_false():
    result = validate_document(["not", "a", "dict"])  # type: ignore[arg-type]
    assert result["ok"] is False and result["errors"]


def test_どんな壊れかたでも例外を投げずissueを返す():
    """/api/admin/definitions/{child}/validate は「保存せず常に 200 で issue を返す」約束.

    doc は利用者が貼れる任意の JSON なので、区画が配列でない等で素の TypeError が出ると
    ドライラン検証そのものが 500 になり、どこが悪いのか画面に出せなくなる。
    """
    leaks = []
    checked = 0
    for label, doc in hostile_docs(load_sample_doc()):
        checked += 1
        try:
            result = validate_document(doc)
        except Exception as e:  # noqa: BLE001 - 漏れた例外の型ごと報告するのが目的
            leaks.append(f"  {label} → {type(e).__name__}: {e}")
            continue
        assert set(result) == {"ok", "errors", "warnings"}
    assert checked > 1000, "組み合わせが集まっていない＝テストが空虚"
    assert not leaks, "validate_document が例外を投げた:\n" + "\n".join(sorted(set(leaks))[:20])


def test_parseが拒む壊れかたはvalidateもerrorsを返す_総当たり():
    """乖離ドリフト防止の総当たり版（上の名前つきケースが代表例）.

    parse には保存経路と同じ assign_keys 済みの doc を渡す。key の欠落は「採番前の
    新規項目」＝正常な途中状態で、validate はそれを許すのが正しい（保存時にサーバが振る）。
    """
    misses = []
    for label, doc in hostile_docs(load_sample_doc()):
        try:
            parse_definition(assign_keys(copy.deepcopy(doc)))
        except SummerDefinitionError:
            pass
        else:
            continue
        if not validate_document(doc)["errors"]:
            misses.append(f"  {label}")
    assert not misses, "parse_definition が拒む doc を validate_document が素通しした:\n" + "\n".join(
        sorted(set(misses))[:20]
    )


def test_採番は壊れたdocでも例外を投げない():
    """assign_keys は検証より前に走るので、ここで落ちると取り込みが 422 でなく 500 になる."""
    leaks = []
    for label, doc in hostile_docs(load_sample_doc()):
        try:
            assign_keys(copy.deepcopy(doc))
        except Exception as e:  # noqa: BLE001 - 漏れた例外の型ごと報告するのが目的
            leaks.append(f"  {label} → {type(e).__name__}: {e}")
    assert not leaks, "assign_keys が例外を投げた:\n" + "\n".join(sorted(set(leaks))[:20])


# ---- warnings ----


def test_kanji_grade_warning(sample_doc):
    sample_doc["habits"][0]["label"] = "宿題タイム"  # 宿・題は小3配当（この子は小2）
    result = validate_document(sample_doc)
    assert result["ok"] is True  # 警告のみ＝保存はできる
    warns = [w for w in result["warnings"] if w["code"] == "kanji_grade"]
    assert len(warns) == 1
    assert warns[0]["path"] == "/habits/0/label"
    assert set(warns[0]["detail"]["chars"]) == {"宿", "題"}
    assert warns[0]["detail"]["grades"] == {"宿": 3, "題": 3}


def test_kanji_grade_名前の字は警告しない(sample_doc):
    # child の名前に含まれる漢字は学年に関係なく許可（配当外でも警告なし）
    sample_doc["child"] = "海斗"
    sample_doc["habits"][0]["label"] = "海斗《かいと》のはみがき"
    result = validate_document(sample_doc)
    assert [w for w in result["warnings"] if w["code"] == "kanji_grade"] == []


def test_mid_period_add_warning(sample_doc):
    prev = load_sample_doc()
    sample_doc["daily_homework"].append({"key": "dh_new123", "label": "あたらしいしゅくだい"})
    # 期間中（8/1）→ 警告
    result = validate_document(sample_doc, prev_doc=prev, today=date(2026, 8, 1))
    warns = [w for w in result["warnings"] if w["code"] == "mid_period_add"]
    assert len(warns) == 1 and warns[0]["path"] == "/daily_homework/6"
    # 期間外（9/15）→ 警告なし
    result2 = validate_document(sample_doc, prev_doc=prev, today=date(2026, 9, 15))
    assert [w for w in result2["warnings"] if w["code"] == "mid_period_add"] == []


def test_mid_period_add_warning_採番前の新規項目でも発火する(sample_doc):
    # 管理画面の保存前 validate は新規項目が key: null のまま届く。key 有無に依らず
    # 「prev に無い項目」を期間中追加として警告する（実測で警告ゼロだった実バグの回帰テスト）。
    prev = load_sample_doc()
    sample_doc["daily_homework"].append({"key": None, "label": "あたらしいしゅくだい"})
    result = validate_document(sample_doc, prev_doc=prev, today=date(2026, 8, 1))
    warns = [w for w in result["warnings"] if w["code"] == "mid_period_add"]
    assert len(warns) == 1 and warns[0]["path"] == "/daily_homework/6"


def test_empty_score_section_warning(sample_doc):
    # 採点区分（せいかつ50／しゅくだい50）を片方だけ空にすると、その区分は0点固定になり
    # 満点が50点になる＝満点スタンプもストリークもチャレンジも永久に出ない。
    # エラーにはしない（作りかけを保存できなくなる）が、気づけないので必ず警告する。
    sample_doc["daily_homework"] = []
    result = validate_document(sample_doc)
    warns = [w for w in result["warnings"] if w["code"] == "empty_score_section"]
    assert result["ok"] is True  # 保存はできる
    assert len(warns) == 1 and warns[0]["path"] == "/daily_homework"

    # 両方空（＝まだ何も入れていない作りかけ）は当たり前なので鳴らさない
    sample_doc["habits"] = []
    assert [
        w for w in validate_document(sample_doc)["warnings"] if w["code"] == "empty_score_section"
    ] == []


def test_rewards_unreachable_warning(sample_doc):
    # サンプル定義はチャレンジ4件＝1日の上限200点。上限ちょうどは「全日満点で到達」＝
    # 正当な設計なので鳴らさず、超えたときだけ鳴らす。
    sample_doc["rewards"][3]["avg"] = 200
    assert [
        w for w in validate_document(sample_doc)["warnings"] if w["code"] == "rewards_unreachable"
    ] == []

    sample_doc["rewards"][3]["avg"] = 201
    result = validate_document(sample_doc)
    assert result["ok"] is True  # 保存はできる
    warns = [w for w in result["warnings"] if w["code"] == "rewards_unreachable"]
    assert len(warns) == 1 and warns[0]["path"] == "/rewards/3/avg"
    assert warns[0]["detail"] == {"avg": 201, "score_max": 200}


def test_rewards_unreachable_チャレンジを減らしても鳴る(sample_doc):
    # ごほうびを据え置いたままチャレンジだけ消すと同じ状態が作れる（issue #28 の一般形）。
    # 日付欄と違って画面には「届かない」手がかりが何も出ないので、ここで知らせる。
    sample_doc["special_challenges"] = []
    warns = [
        w for w in validate_document(sample_doc)["warnings"] if w["code"] == "rewards_unreachable"
    ]
    assert [w["path"] for w in warns] == ["/rewards/2/avg", "/rewards/3/avg"]
    assert [w["detail"]["score_max"] for w in warns] == [100, 100]


def test_rewards_unreachable_avgが不正なランクでは鳴らさない(sample_doc):
    # avg 自体がエラーなら「届く／届かない」は判定しない（エラーが先・警告は重ねない）。
    sample_doc["special_challenges"] = []
    sample_doc["rewards"][3]["avg"] = 1.5
    result = validate_document(sample_doc)
    warns = [w for w in result["warnings"] if w["code"] == "rewards_unreachable"]
    assert [w["path"] for w in warns] == ["/rewards/2/avg"]
    assert any(e["code"] == "rewards_avg" for e in result["errors"])


def test_delete_with_records_warning(sample_doc):
    prev = load_sample_doc()
    sample_doc["daily_homework"] = [i for i in sample_doc["daily_homework"] if i["key"] != "nikki"]
    # 消した項目に記録あり → 警告（件数つき）
    result = validate_document(sample_doc, prev_doc=prev, usage={"nikki": 4})
    warns = [w for w in result["warnings"] if w["code"] == "delete_with_records"]
    assert len(warns) == 1
    assert warns[0]["detail"] == {"key": "nikki", "count": 4}
    # 記録が無ければ警告なし
    result2 = validate_document(sample_doc, prev_doc=prev, usage={"nikki": 0})
    assert [w for w in result2["warnings"] if w["code"] == "delete_with_records"] == []


def test_records_outside_period_warning(sample_doc):
    # 期間より前に記録がある → 警告
    result = validate_document(sample_doc, record_days=("2026-07-01", "2026-08-31"))
    warns = [w for w in result["warnings"] if w["code"] == "records_outside_period"]
    assert len(warns) == 1
    assert warns[0]["detail"] == {"min_day": "2026-07-01", "max_day": "2026-08-31"}
    # 期間内に収まっていれば警告なし
    result2 = validate_document(sample_doc, record_days=("2026-07-18", "2026-08-31"))
    assert [w for w in result2["warnings"] if w["code"] == "records_outside_period"] == []


@pytest.mark.parametrize("bad", [0, -1, EDGES_WINDOW_DAYS_MAX + 1, 10**9, "ゼロ", True, 1.5])
def test_edges_window_daysの範囲外はparseもvalidateも拒む(sample_doc, bad):
    """0以下だと edges の記録欄が全日ひっこんで採点の分母が黙って変わり、
    巨大値だと judge.in_edges_window の日付加算が OverflowError＝子ども画面が 500 になる。
    どちらも「取り込めるのに保存できない」を作らないよう、両側で同じ範囲に閉じる。
    """
    sample_doc["card_rules"]["edges_window_days"] = bad
    with pytest.raises(SummerDefinitionError):
        parse_definition(copy.deepcopy(sample_doc))
    result = validate_document(sample_doc)
    assert result["ok"] is False
    assert any(e["path"] == "/card_rules/edges_window_days" for e in result["errors"])


def test_parseとvalidateは同じ壊れかたを拒む_逆向き総当たり():
    """「parse は通すのに validate が弾く」ズレの恒常検査（既存の検査は逆向きだけ）.

    この向きのズレは、インポートで取り込めた定義が管理画面から二度と保存できなくなる
    （draft.save() は validate が ok=false なら PUT しない）。利用者から見ると
    「開けるのに保存できない子」ができ、画面から直す手段がない。
    """
    misses = []
    for label, doc in hostile_docs(load_sample_doc()):
        try:
            parse_definition(assign_keys(copy.deepcopy(doc)))
        except SummerDefinitionError:
            continue  # parse が拒む＝そもそも保存されない
        if validate_document(doc)["errors"]:
            misses.append(f"  {label}")
    assert not misses, (
        "parse_definition が受け入れた doc を validate_document が拒んだ"
        "（＝インポートできるのに管理画面から保存できない）:\n" + "\n".join(sorted(set(misses))[:20])
    )

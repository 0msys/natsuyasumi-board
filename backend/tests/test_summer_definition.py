"""定義ドキュメント（app/summer/definition.py）の検証テスト.

サンプル JSON（docs/examples/2026-はな.json）の実データ照合と、parse_definition の
エラーケース（grade・期間順序・key 重複2空間・rewards・window・meta）を固定する。
DB 経由の load_definition / list_children も往復で確認する。
"""

from __future__ import annotations

from datetime import date

import json

import pytest

from app import db as app_db
from app.summer.definition import (
    SummerDefinitionError,
    list_children,
    load_definition,
    parse_definition,
    parse_grade,
)
from tests.conftest import CHILD, hostile_docs, load_sample_doc


# ---- サンプル JSON の実データ照合 ----


def test_サンプル定義が読める(definition):
    assert definition.child == "はな"
    assert definition.child_kana == "はな"
    assert definition.year == 2026
    assert definition.grade == "小2" and definition.grade_level == 2
    assert definition.start == date(2026, 7, 18)
    assert definition.end == date(2026, 8, 31)
    assert definition.first_day_of_school == date(2026, 9, 1)


def test_ISO日付文字列はdateへ正規化される(definition):
    # JSON の 'YYYY-MM-DD' 文字列が date オブジェクトになっている（全日付フィールド）
    assert isinstance(definition.start, date)
    radio = next(h for h in definition.habits if h.key == "radio_taisou")
    assert radio.window_start == date(2026, 7, 21) and radio.window_end == date(2026, 7, 24)
    assert definition.away[0].start == date(2026, 8, 7) and definition.away[0].end == date(2026, 8, 14)
    uwabaki = next(i for i in definition.school_start_items if i.key == "uwabaki")
    assert uwabaki.due == date(2026, 8, 31)


def test_card_rulesの既定値(definition):
    assert definition.card_rules.edges_window_days == 5
    # 区画ごと無くても既定5日で読める（古い定義・手書きの最小定義のため）
    doc = load_sample_doc()
    del doc["card_rules"]
    assert parse_definition(doc).card_rules.edges_window_days == 5


def test_日次項目のkeyが一意(definition):
    keys = [i.key for i in definition.daily_items()]
    assert len(keys) == len(set(keys))
    # はみがき3回・edges 窓4項目・range 窓1項目が存在する（採点・窓判定の前提）
    assert sum(1 for h in definition.habits if h.key.startswith("hamigaki_")) == 3
    assert sum(1 for h in definition.habits if h.window == "edges") == 4
    assert sum(1 for h in definition.habits if h.window == "range") == 1


def test_flags側のkeyが一意でドット連結(definition):
    keys = definition.flag_item_keys()
    assert len(keys) == len(set(keys))
    group = definition.choice_homework[0]
    assert all(o.key.startswith(f"{group.key}.") for o in group.options)
    assert 1 <= group.min_required <= len(group.options)


def test_count型はtargetを持つ(definition):
    counts = [i for i in definition.one_shot_homework if i.type == "count"]
    assert counts, "読書のカウント型項目があるはず"
    assert all(isinstance(i.target, int) and i.target >= 1 for i in counts)


def test_meta定義_音読はtext_計算カードはchoiceとduration(definition):
    ondoku = next(i for i in definition.daily_homework if i.key == "ondoku")
    assert [(f.key, f.type) for f in ondoku.meta] == [("book", "text")]
    keisan = next(i for i in definition.practice_homework if i.key == "keisan")
    assert [(f.key, f.type) for f in keisan.meta] == [("calc_type", "choice"), ("seconds", "duration")]
    calc_type = keisan.meta_field("calc_type")
    assert [o.key for o in calc_type.options] == ["tashizan", "hikizan"]
    # メモの無い項目（にっき）は空タプル
    assert next(i for i in definition.daily_homework if i.key == "nikki").meta == ()


def test_スペシャルチャレンジとごほうびランクが読める(definition):
    assert [c.key for c in definition.special_challenges] == ["gakki", "otetsudai", "eigo", "tairyoku_ch"]
    assert set(c.key for c in definition.special_challenges) <= definition.daily_item_keys()
    assert [(r.key, r.avg) for r in definition.rewards] == [("c", 80), ("b", 100), ("a", 150), ("s", 180)]
    assert all(r.prize is None for r in definition.rewards)


# ---- grade の検証 ----


def test_parse_grade_正常(definition):
    assert parse_grade("小2", "テスト") == ("小2", 2)
    assert parse_grade("小6", "テスト") == ("小6", 6)


# "小3\n" は正規表現の $ が末尾改行の手前にも当たるため、fullmatch でないとすり抜けて
# 改行つきのまま表示用 grade として保存されてしまう（前後の空白も同様に弾く）
@pytest.mark.parametrize("bad", ["小7", "小0", "", "2年", "中1", None, 2, "小3\n", "小3 ", " 小3"])
def test_grade_不正はエラー(bad):
    doc = load_sample_doc()
    doc["grade"] = bad
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


# ---- period の検証 ----


@pytest.mark.parametrize(
    "period",
    [
        {"start": "2026-09-30", "end": "2026-08-31", "first_day_of_school": "2026-10-01"},  # start > end
        {"start": "2026-07-18", "end": "2026-09-01", "first_day_of_school": "2026-09-01"},  # end == 始業式
        {"start": "2026-07-18", "end": "2026-07-18", "first_day_of_school": "2026-09-01"},  # start == end
        {"start": "7月18日", "end": "2026-08-31", "first_day_of_school": "2026-09-01"},  # 日付形式不正
        {"end": "2026-08-31", "first_day_of_school": "2026-09-01"},  # start 欠落
    ],
)
def test_period_不正はエラー(period):
    doc = load_sample_doc()
    doc["period"] = period
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


# ---- key の一意性（日次系と flags 系は別空間） ----


def test_key重複_daily空間はエラー():
    doc = load_sample_doc()
    doc["habits"][0]["key"] = "ondoku"  # daily_homework と衝突
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_key重複_チャレンジとhabitの衝突もエラー():
    doc = load_sample_doc()
    doc["special_challenges"][0]["key"] = "hamigaki_asa"
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_key重複_flags空間はエラー():
    doc = load_sample_doc()
    doc["school_start_items"][0]["key"] = "enikki"  # one_shot と衝突
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_key重複_別空間なら許される():
    # 日次系（daily_checks）と flags 系はテーブルが別＝同じ key が共存できる
    doc = load_sample_doc()
    doc["one_shot_homework"][0]["key"] = "ondoku"  # daily_homework と同名だが空間が別
    parsed = parse_definition(doc)
    assert "ondoku" in parsed.daily_item_keys() and "ondoku" in parsed.flag_item_keys()


# ---- rewards の検証 ----


@pytest.mark.parametrize(
    "rewards",
    [
        [{"key": "c", "label": "ランクC"}],  # avg 欠落
        [{"key": "c", "label": "ランクC", "avg": "たくさん"}],  # avg 非int
        [{"key": "c", "label": "ランクC", "avg": 0}],  # avg 0以下
        [{"key": "c", "label": "ランクC", "avg": True}],  # bool は int 扱いしない
        [{"key": "c", "label": "C", "avg": 100}, {"key": "b", "label": "B", "avg": 80}],  # 降順
        [{"key": "c", "label": "C", "avg": 80}, {"key": "b", "label": "B", "avg": 80}],  # 同値
        [{"key": "c", "label": "A", "avg": 80}, {"key": "c", "label": "B", "avg": 100}],  # key 重複
        [{"label": "ランクC", "avg": 80}],  # key 欠落
    ],
)
def test_rewards_不正はエラー(rewards):
    doc = load_sample_doc()
    doc["rewards"] = rewards
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_rewards_無しは空タプル_prizeは任意():
    doc = load_sample_doc()
    del doc["rewards"]
    assert parse_definition(doc).rewards == ()
    doc2 = load_sample_doc()
    doc2["rewards"] = [{"key": "c", "label": "ランクC", "avg": 80, "prize": "アイス"}]
    assert parse_definition(doc2).rewards[0].prize == "アイス"


# ---- 読み上げの声（子どもごとの VOICEVOX 話者） ----


def test_voice_サンプル定義の声が読める(definition):
    assert definition.voice is not None
    assert definition.voice.speaker == 3
    assert definition.voice.label == "ずんだもん（ノーマル）"


def test_voice_無しはNone_labelは任意():
    # 区画ごと無い定義（既存データ・手書きの最小定義）は None＝既定の話者で読み上げる
    doc = load_sample_doc()
    del doc["voice"]
    assert parse_definition(doc).voice is None
    doc2 = load_sample_doc()
    doc2["voice"] = {"speaker": 8}
    voice = parse_definition(doc2).voice
    assert voice is not None and voice.speaker == 8 and voice.label is None


@pytest.mark.parametrize(
    "voice",
    [
        {"label": "ずんだもん"},  # speaker 欠落
        {"speaker": -1},  # 負の話者ID
        {"speaker": "3"},  # 文字列
        {"speaker": 3.5},  # 小数
        {"speaker": True},  # bool（int のサブクラス）
        [3],  # マップでない
    ],
)
def test_voice_不正はエラー(voice):
    doc = load_sample_doc()
    doc["voice"] = voice
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


# ---- 壊れた定義は必ず SummerDefinitionError（呼び出し側が障害と区別できるように） ----


@pytest.mark.parametrize(
    ("name", "mutate"),
    [
        ("yearが数字でない", lambda d: d.update(year="にせんにじゅうろく")),  # int() の ValueError
        ("edges_window_daysが数字でない", lambda d: d.update(card_rules={"edges_window_days": "ごにち"})),
        ("min_requiredが数字でない", lambda d: d["choice_homework"][0].update(min_required="ひとつ")),
        ("choiceのoptionsが配列でない", lambda d: d["choice_homework"][0].update(options=3)),  # TypeError
        ("choiceのoptionにkeyが無い", lambda d: d["choice_homework"][0].update(options=[{"label": "本"}])),
        ("awayの項目が文字列", lambda d: d.update(away=["おばあちゃんのいえ"])),
        ("habitsが配列でない", lambda d: d.update(habits=1)),
    ],
    ids=lambda v: v if isinstance(v, str) else "",
)
def test_個別チェックを抜けた壊れかたもSummerDefinitionError(name, mutate):
    # 素の ValueError / TypeError / KeyError が漏れると、呼び出し側が「定義が壊れている」と
    # 「サーバの障害」を区別できず、except を広げて本物の障害まで握りつぶすことになる
    doc = load_sample_doc()
    mutate(doc)
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_どんな壊れかたでもSummerDefinitionError以外は投げない():
    """サンプル定義の全パスを敵対的な値へ差し替えても、外へ出るのは SummerDefinitionError だけ.

    上の名前つきケースは代表例で、こちらが本体（新しい欄を足したときに自動で守られる）。

    この契約を parse_definition を try/except で包んで満たすのは不可: パーサ自身のバグまで
    「あなたの定義が壊れています」と報告してしまい、利用者は壊れていない定義を直しに行く。
    欄ごとに型を確かめる（_as_int / _as_entries / _as_entry）ことでしか守れない。
    """
    leaks = []
    checked = 0
    for label, doc in hostile_docs(load_sample_doc()):
        checked += 1
        try:
            parse_definition(doc)
        except SummerDefinitionError:
            pass
        except Exception as e:  # noqa: BLE001 - 漏れた例外の型ごと報告するのが目的
            leaks.append(f"  {label} → {type(e).__name__}: {e}")
    assert checked > 1000, "組み合わせが集まっていない＝テストが空虚"
    assert not leaks, "SummerDefinitionError 以外が漏れた:\n" + "\n".join(sorted(set(leaks))[:20])


def test_壊れた定義はlist_childrenでもvalid_falseになる(tmp_db):
    # 素の例外が漏れると、1人壊れただけで子ども一覧そのものが 500 になってしまう
    with app_db.connect(tmp_db) as conn:
        conn.execute(
            "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, 0)",
            ("こわれたこ", 2026, json.dumps({**load_sample_doc(), "child": "こわれたこ", "year": "にせん"})),
        )
    entry = next(e for e in list_children(db_path=tmp_db) if e["child"] == "こわれたこ")
    assert entry["valid"] is False and entry["error"]


# ---- テレビタイマーの上限（子どもごと） ----


def test_media_timer_サンプル定義の上限が読める(definition):
    assert definition.media_timer.limit_minutes == 120
    assert definition.media_timer.limit_seconds == 7200


def test_media_timer_無しは既定2時間():
    # 区画ごと無い定義（この機能より前に作られたデータ・手書きの最小定義）は既定に倒す
    doc = load_sample_doc()
    del doc["media_timer"]
    assert parse_definition(doc).media_timer.limit_minutes == 120
    doc2 = load_sample_doc()
    doc2["media_timer"] = {}  # 区画はあるが limit_minutes 未指定
    assert parse_definition(doc2).media_timer.limit_minutes == 120


@pytest.mark.parametrize("minutes", [1, 30, 90, 1440])
def test_media_timer_上限を子どもごとに変えられる(minutes):
    doc = load_sample_doc()
    doc["media_timer"] = {"limit_minutes": minutes}
    rules = parse_definition(doc).media_timer
    assert rules.limit_minutes == minutes and rules.limit_seconds == minutes * 60


@pytest.mark.parametrize(
    "media_timer",
    [
        {"limit_minutes": 0},  # 0分（タイマーの意味がない）
        {"limit_minutes": -30},  # 負
        {"limit_minutes": 1441},  # 1日ぶんを超える
        {"limit_minutes": "120"},  # 文字列
        {"limit_minutes": 90.5},  # 小数
        {"limit_minutes": True},  # bool（int のサブクラス）
        [120],  # マップでない
    ],
)
def test_media_timer_不正はエラー(media_timer):
    doc = load_sample_doc()
    doc["media_timer"] = media_timer
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


# ---- one_shot / choice / window / meta の検証 ----


def test_count型のtarget欠落はエラー():
    doc = load_sample_doc()
    del doc["one_shot_homework"][2]["target"]  # dokusho（count 型）
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_one_shot_type不正はエラー():
    doc = load_sample_doc()
    doc["one_shot_homework"][0]["type"] = "many"
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


@pytest.mark.parametrize("min_required", [0, 7])
def test_min_requiredが選択肢数と矛盾はエラー(min_required):
    doc = load_sample_doc()
    doc["choice_homework"][0]["min_required"] = min_required  # 選択肢は6個
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_window不正はエラー():
    doc = load_sample_doc()
    doc["habits"][3]["window"] = "sometimes"
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_range窓の順序不正はエラー():
    doc = load_sample_doc()
    radio = next(h for h in doc["habits"] if h["key"] == "radio_taisou")
    radio["window_start"] = "2026-07-25"  # window_end(7/24) より後
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_range窓のwindow_start欠落はエラー():
    doc = load_sample_doc()
    radio = next(h for h in doc["habits"] if h["key"] == "radio_taisou")
    del radio["window_start"]
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


def test_choice型metaのoptions欠落はエラー():
    doc = load_sample_doc()
    keisan = next(i for i in doc["practice_homework"] if i["key"] == "keisan")
    keisan["meta"][0]["options"] = []
    with pytest.raises(SummerDefinitionError):
        parse_definition(doc)


# ---- DB 経由（load_definition / list_children） ----


def test_load_definition_DBラウンドトリップ(seeded_db, definition):
    loaded = load_definition(CHILD, db_path=seeded_db)
    assert loaded == definition  # frozen dataclass の等価性で全フィールド照合


def test_load_definition_未登録はエラー(tmp_db):
    with pytest.raises(SummerDefinitionError):
        load_definition("しらないこ", db_path=tmp_db)


def test_list_children_正常定義(seeded_db):
    children = list_children(db_path=seeded_db)
    assert len(children) == 1
    entry = children[0]
    assert entry["child"] == CHILD and entry["year"] == 2026 and entry["revision"] == 1
    assert entry["valid"] is True and entry["error"] is None
    assert entry["grade"] == "小2" and entry["child_kana"] == "はな"
    assert entry["period"]["start"] == "2026-07-18"


def test_list_children_壊れ定義もエラーつきで返す(tmp_db):
    # create_definition は検証済みしか書かないため、壊れ行は SQL 直挿入で再現する
    with app_db.connect(tmp_db) as conn:
        conn.execute(
            "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, 0)",
            ("こわれたこ", 2026, "{broken json"),
        )
        conn.execute(
            "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, 0)",
            ("ふそくのこ", 2026, json.dumps({"child": "ふそくのこ"})),
        )
    children = {e["child"]: e for e in list_children(db_path=tmp_db)}
    assert children["こわれたこ"]["valid"] is False and children["こわれたこ"]["error"]
    assert children["ふそくのこ"]["valid"] is False and children["ふそくのこ"]["error"]
    # 壊れていても load_definition は SummerDefinitionError（500 にしない）
    with pytest.raises(SummerDefinitionError):
        load_definition("こわれたこ", db_path=tmp_db)


def test_list_children_最新年のみ(seeded_db, sample_doc):
    # 同じ子の過去年を追加 → 一覧は最新年（2026）だけ
    old = dict(sample_doc)
    with app_db.connect(seeded_db) as conn:
        conn.execute(
            "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, 0)",
            (CHILD, 2025, json.dumps(old, ensure_ascii=False)),
        )
    children = list_children(db_path=seeded_db)
    assert len(children) == 1 and children[0]["year"] == 2026

"""「きょうやること」読み上げ文（app/summer/speech.py）の特性化テスト.

呼びかけは「{child_kana}さん。」。定義はサンプル JSON（はな・小2）を使う。
"""

from __future__ import annotations

from datetime import date

import pytest

from app.summer import kanji, speech
from app.summer.definition import parse_definition
from app.summer.judge import remaining_today
from app.summer.kanji import ruby_reading
from app.summer.speech import todo_speech_text

ALL_DONE_MIDSUMMER = {
    "hamigaki_asa": "done",
    "hamigaki_hiru": "done",
    "hamigaki_yoru": "done",
    "ondoku": "done",
    "nikki": "done",
    "keisan": "done",
    "kenban": "done",
    "drill": "done",
    "jishu": "done",
}


def test_ぜんぶできた日はほめる文(definition):
    day = date(2026, 8, 1)  # 窓外・おでかけでない日
    items = remaining_today(day, ALL_DONE_MIDSUMMER, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    assert text.startswith("はなさん。")
    assert "ぜんぶできているよ" in ruby_reading(text)


def test_未記入があると項目名が入る(definition):
    day = date(2026, 8, 1)
    statuses = {k: "done" for k in ALL_DONE_MIDSUMMER if k != "ondoku"}
    items = remaining_today(day, statuses, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    assert "おんどく" in ruby_reading(text)  # ラベル「音読《おんどく》（カードに書《か》く）」
    assert "ぜんぶできているよ" not in ruby_reading(text)


def test_帰省中はおでかけ文(definition):
    day = date(2026, 8, 8)  # おばあちゃんのいえ 滞在中（8/7〜8/14）
    items = remaining_today(day, ALL_DONE_MIDSUMMER, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    assert "おでかけ" in ruby_reading(text)


def test_新学期じゅんびは期限つきで入る(definition):
    day = date(2026, 8, 30)
    items = remaining_today(day, ALL_DONE_MIDSUMMER, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    assert "うわばき" in ruby_reading(text)
    assert "8/31まで" in ruby_reading(text)


def test_終盤は一回もの宿題を促す(definition):
    day = date(2026, 8, 27)
    items = remaining_today(day, ALL_DONE_MIDSUMMER, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    assert "なつやすみのおわりがちかい" in ruby_reading(text)


def test_旧くりかえし宿題も項目名で促される(definition):
    # 「くりかえしのしゅくだいをどれかひとつ」の集約行は廃止した。宿題はどの項目も
    # まいにちと同じく名前で読み上げる（採点の重みが同じなので案内も揃える）。
    day = date(2026, 8, 1)
    statuses = {k: "done" for k in ALL_DONE_MIDSUMMER if k != "keisan"}
    items = remaining_today(day, statuses, {}, {}, definition)
    text = todo_speech_text(day, items, definition)
    reading = ruby_reading(text)
    assert "けいさんカードのれんしゅう" in reading
    assert "どれかひとつ" not in reading


# ---- 定型文そのものの lint と、学年別の開きが本当に効いているか ----
# 既存の assert は全部 ruby_reading() 越し＝読みだけを見ており、open_for_grade を
# 恒等関数に差し替えても素通りする（＝学年別の開きに構造的に不感）。
# ここは「読み」ではなく「表示そのもの」を突き合わせる。


def test_定型文が最大漢字の正規形():
    texts = list(speech._LINES.values())
    assert len(texts) >= 5, "定型文が集まっていない＝テストが空虚"
    offenders = [(t, p) for t in texts if (p := kanji.validate_ruby_source(t))]
    assert not offenders, f"読み上げ定型文のルビ記法が正規形でない: {offenders}"


@pytest.mark.parametrize("grade", [1, 2, 3, 4, 5, 6])
def test_定型文が各学年の配当内(grade):
    offenders = [
        (opened, sorted(bad))
        for t in speech._LINES.values()
        if (bad := kanji.nonconforming_kanji(opened := kanji.open_for_grade(t, grade), grade=grade))
    ]
    assert not offenders, f"小{grade} の読み上げ文に配当外の漢字: {offenders}"


def _speech_for(sample_doc, grade: str) -> str:
    sample_doc["grade"] = grade
    definition = parse_definition(sample_doc)
    day = date(2026, 8, 1)
    items = remaining_today(day, ALL_DONE_MIDSUMMER, {}, {}, definition)
    return todo_speech_text(day, items, definition)


def test_読み上げ文は学年で漢字の量が変わる(sample_doc):
    """open_for_grade を外しても読みは変わらないので、表示そのものを直値で押さえる."""
    g1 = _speech_for(sample_doc, "小1")
    g6 = _speech_for(sample_doc, "小6")
    assert g1 != g6, "学年で表示が変わっていない＝開きが効いていない"
    # 小1 はまだ習っていない字が1つも出ない
    assert not kanji.nonconforming_kanji(g1, grade=1), g1
    for word in ("宿題", "記録", "全部"):
        assert word not in g1, f"小1 の読み上げ文に {word} が出ている: {g1}"
    # 読み（＝音声）は学年で変わらない
    assert ruby_reading(g1) == ruby_reading(g6)

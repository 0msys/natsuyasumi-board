"""定型褒めメッセージ（app/summer/praise.py）の決定性とバンド選択のテスト.

- スコア帯の境界（100/80/50/0・bonus 有無・記録なし not_yet）
- 同じ子・同じ日なら常に同じ文（crc32 安定選択）
- perfect_plus のときだけチャレンジ文言が付く（未実施チャレンジに言及しない非対称原則）
- おでかけ日の文言・学年帯（low/mid/high）の選択
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.summer import praise
from app.summer.judge import ScoreBreakdown
from app.summer import kanji
from app.summer.kanji import grade_band  # 学年帯の単一真実源は kanji.py（praise は利用側）
from app.summer.praise import (
    BAND_GOOD,
    BAND_GREAT,
    BAND_KEEP_GOING,
    BAND_NOT_YET,
    BAND_PERFECT,
    BAND_PERFECT_PLUS,
    build_praise,
    score_band,
)


def _score(base: int, bonus: int = 0) -> ScoreBreakdown:
    return ScoreBreakdown(score=base, parts=(), bonus=bonus, total=base + bonus)


# ---- スコア帯の境界 ----


@pytest.mark.parametrize(
    ("base", "bonus", "has_records", "expected"),
    [
        (100, 25, True, BAND_PERFECT_PLUS),
        (100, 0, True, BAND_PERFECT),
        (99, 0, True, BAND_GREAT),
        (80, 0, True, BAND_GREAT),  # 80 ちょうどは great
        (79, 0, True, BAND_GOOD),
        (50, 0, True, BAND_GOOD),  # 50 ちょうどは good
        (49, 0, True, BAND_KEEP_GOING),
        (0, 0, True, BAND_KEEP_GOING),
        (0, 0, False, BAND_NOT_YET),  # 記録が1件もない
        (100, 0, False, BAND_NOT_YET),  # has_records が最優先
    ],
)
def test_score_band_境界(base, bonus, has_records, expected):
    assert score_band(_score(base, bonus), has_records) == expected


# ---- 学年帯 ----


@pytest.mark.parametrize(
    ("grade_level", "expected"),
    [(1, "low"), (2, "low"), (3, "mid"), (4, "mid"), (5, "high"), (6, "high"), (7, "high"), (0, "low")],
)
def test_grade_band_3帯選択(grade_level, expected):
    assert grade_band(grade_level) == expected


# ---- build_praise（サンプル定義＝小2 → low 帯） ----

DAY = date(2026, 8, 1)  # おでかけでない日


def _readings(variants):
    """表示は学年で漢字の量が変わるので、テストは読み（言い回し）で突き合わせる."""
    return [kanji.ruby_reading(v) for v in variants]


def test_記録なしはnot_yetで点数文なし(definition):
    result = build_praise("はな", DAY, _score(0), False, definition)
    assert result["band"] == BAND_NOT_YET
    assert result["score"] == 0 and result["total"] == 0
    assert "てんだよ" not in kanji.ruby_reading(result["text"])  # 点数の一文は出さない
    assert kanji.ruby_reading(result["text"]) in _readings(praise.MESSAGES["low"][BAND_NOT_YET])


def test_同日決定性_同じ入力で同じ文(definition):
    a = build_praise("はな", DAY, _score(80), True, definition)
    b = build_praise("はな", DAY, _score(80), True, definition)
    assert a == b
    assert a["band"] == BAND_GREAT
    assert kanji.ruby_reading(a["text"]).startswith("きょうは 80てんだよ。")  # low 帯の点数文
    # 本文はバンクのバリアントから選ばれている
    assert any(v in kanji.ruby_reading(a["text"]) for v in _readings(praise.MESSAGES["low"][BAND_GREAT]))


def test_日が変わるとバリアントが回る(definition):
    # crc32 は日毎に変わる＝十分な日数を見れば複数バリアントが使われる
    texts = {
        build_praise("はな", DAY + timedelta(days=i), _score(80), True, definition)["text"].removeprefix(
            "きょうは 80てんだよ。"
        )
        for i in range(10)
    }
    assert len(texts) > 1


def test_perfect_plusのみチャレンジ文言(definition):
    plus = build_praise("はな", DAY, _score(100, bonus=50), True, definition)
    assert plus["band"] == BAND_PERFECT_PLUS
    assert "チャレンジで ＋50てん、ぜんぶで 150てんだよ。" in kanji.ruby_reading(plus["text"])

    # base 100 でもチャレンジ未実施（bonus 0）なら perfect ＝ チャレンジに一切ふれない
    perfect = build_praise("はな", DAY, _score(100), True, definition)
    assert perfect["band"] == BAND_PERFECT
    assert "チャレンジ" not in perfect["text"]

    # base 100 未満はチャレンジ文言なし（bonus は judge 側で 0 になる契約）
    great = build_praise("はな", DAY, _score(80), True, definition)
    assert "チャレンジ" not in great["text"]


def test_away文言はおでかけ日だけ(definition):
    away_day = date(2026, 8, 8)  # おばあちゃんのいえ（8/7〜8/14）
    away = build_praise("はな", away_day, _score(80), True, definition)
    assert kanji.ruby_reading(away["text"]).endswith(kanji.ruby_reading(praise.AWAY_LINE["low"]))
    normal = build_praise("はな", DAY, _score(80), True, definition)
    assert kanji.ruby_reading(praise.AWAY_LINE["low"]) not in kanji.ruby_reading(normal["text"])


def _praise_for(sample_doc, grade: str):
    from app.summer.definition import parse_definition

    sample_doc["grade"] = grade
    return build_praise("はな", DAY, _score(80), True, parse_definition(sample_doc))


def test_学年で漢字の量が変わる(sample_doc):
    """口調は帯（low/mid/high）、漢字の開き具合は学年ごと。読みはどちらでも変わらない."""
    g1 = _praise_for(sample_doc, "小1")
    g2 = _praise_for(sample_doc, "小2")
    g5 = _praise_for(sample_doc, "小5")
    # 「今」「点」は小2配当 → 小1では かな、小2から漢字（帯は小1も小2も low で同じ）
    assert g1["text"].startswith("きょうは 80てんだよ。")
    assert g2["text"].startswith("今日《きょう》は 80点《てん》だよ。")
    assert g5["text"].startswith("今日《きょう》は80点《てん》だよ。")
    # 同じ帯（low）なら読みは完全に同じ＝漢字の量だけが違う
    assert kanji.ruby_reading(g1["text"]) == kanji.ruby_reading(g2["text"])


def test_学年帯で口調が変わる(sample_doc):
    """low と high は言い回しそのものが違う（漢字の開き具合とは別の軸）."""
    low = kanji.ruby_reading(_praise_for(sample_doc, "小2")["text"])
    high = kanji.ruby_reading(_praise_for(sample_doc, "小5")["text"])
    assert low != high
    assert low.startswith("きょうは 80てんだよ。")  # low は分かち書き
    assert high.startswith("きょうは80てんだよ。")  # high は詰める


def test_返り値にスコア内訳が載る(definition):
    result = build_praise("はな", DAY, _score(100, bonus=25), True, definition)
    assert result["score"] == 100 and result["bonus"] == 25 and result["total"] == 125

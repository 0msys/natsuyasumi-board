"""初回ウィザードのテンプレート（app/admin/template.py）の、採点にかかわる不変条件.

ラベルの漢字は test_summer_kanji.py が見る。ここは「作った直後の定義が、そのまま
遊べる状態になっているか」＝ごほうびに手が届くか・検証が黙って通るか だけを見る。

閾値だけをサンプル定義から写して、テンプレートのチャレンジ数（2件＝1日の上限150点）に
合わせ直さなかったために、ランクSが数学的に到達不可能だった（issue #28）。値を直すだけだと
あとでチャレンジ数を変えたときに同じ穴があくので、関係のほうを固定する。
"""

from __future__ import annotations

import pytest

from app.admin.template import TEMPLATES, empty_template, standard_template
from app.admin.validate import validate_document
from app.summer.judge import CHALLENGE_POINTS

PERIOD = {"start": "2026-07-21", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}
GRADES = ["小1", "小2", "小3", "小4", "小5", "小6"]


@pytest.mark.parametrize("kind", sorted(TEMPLATES))
@pytest.mark.parametrize("grade", [*GRADES, "こわれた学年"])
def test_テンプレートのごほうびは1日の上限で届く(kind, grade):
    doc = TEMPLATES[kind]("はな", "はな", grade, 2026, PERIOD)
    score_max = 100 + CHALLENGE_POINTS * len(doc["special_challenges"])
    over = [(r["key"], r["avg"]) for r in doc["rewards"] if r["avg"] > score_max]
    assert not over, (
        f"{kind}/{grade}: 1日も欠かさず全部やっても届かないランクがある"
        f"（1日の上限は{score_max}点）: {over}"
    )


@pytest.mark.parametrize("grade", GRADES)
def test_標準テンプレートは検証を警告なしで通る(grade):
    # はじめてこのアプリを触る親が最初に作る定義。ここに警告が出るなら、
    # 「作った直後に赤や黄が出ている」か「出ないまま到達不可能」のどちらかで、どちらも困る。
    doc = standard_template("はな", "はな", grade, 2026, PERIOD)
    assert validate_document(doc) == {"ok": True, "errors": [], "warnings": []}


@pytest.mark.parametrize("grade", GRADES)
def test_空テンプレートは空区分の警告だけを連れて通る(grade):
    # 「からっぽ」は正当な出発点なので保存は通す（errors なし）。ただし両区分とも空＝
    # 点数が0点から永久に動かない状態なので、直す先を指す警告が必ず要る（issue #34）。
    # テンプレートと検証の交差で固定する——どちらかを触ったときに、ここで気づける。
    doc = empty_template("はな", "はな", grade, 2026, PERIOD)
    result = validate_document(doc)
    assert result["ok"] is True
    assert result["errors"] == []
    assert [(w["code"], w["path"]) for w in result["warnings"]] == [
        ("empty_score_section", "/habits"),
        ("empty_score_section", "/daily_homework"),
    ]

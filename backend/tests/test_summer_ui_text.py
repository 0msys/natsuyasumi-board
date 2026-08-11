"""画面固定文言（app/summer/ui_text.py）の lint とスナップショット.

文言は「最大漢字＋総ルビ」で1本だけ書き、学年ごとの表示は kanji.open_for_grade() が導出する。
守るべき性質:

- 正規形（基底は漢字だけ・よみはその基底の読みだけ・送り仮名は基底の外）
- 配当外の漢字がどの学年にも出ない
- 読み（発音）が全学年で同じ＝ aria-label / title / 読み上げが学年でぶれない
- 画面が参照するキーと文言表のキーが一致する（typo と死にエントリの両方を落とす）
- 6学年の実表示が固定される（tests/ui_text_snapshot.json がレビュー面）

なお今回の移行で、読み自体を意図的に変えたものが5件ある（いずれも元がルビ無しの
裸の漢字・大人向け表現だったもの）:

- homework_progress_days / homework_done_days: 「{n}日め」「{n}日」→ 日 にルビを振り「にち」
- homework_done_days_title: 「やった日のかず」→ 日 にルビを振り「ひ」
- check_cancelled_aria: 「雨などでおやすみ」→ 雨 にルビを振り「あめ」
- close_aria: テレビタイマーの×ボタン「閉じる」→ 他の閉じるボタンと同じ「とじる」に統一
- timer_error_*: 「テレビタイマーの取得に失敗しました: <例外>」→ 子どもに読める文言に
  （生の例外は console へ）
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.summer import kanji
from app.summer.definition import MEDIA_LIMIT_MINUTES_MAX
from app.summer.ui_text import UI_TEXT, media_limit_label, ui_text_for

GRADES = range(kanji.GRADE_MIN, kanji.GRADE_MAX + 1)

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
# リポジトリ直下の .gitignore に `data/` があるため、tests/data/ に置くと
# コミットされず、クリーンなクローンでこのテストがファイル不在で落ちる。
SNAPSHOT_PATH = Path(__file__).parent / "ui_text_snapshot.json"

# 画面側の参照（`ui.key` / `summer.ui.key`）を拾う
_UI_REF_RE = re.compile(r"\bui\.([a-z0-9_]+)\b")


def _referenced_keys() -> set[str]:
    """子ども向け画面の .svelte が実際に参照している ui キー."""
    keys: set[str] = set()
    for path in FRONTEND_SRC.rglob("*.svelte"):
        if "admin" in path.parts:  # 管理画面は親が読むので対象外
            continue
        keys |= set(_UI_REF_RE.findall(path.read_text(encoding="utf-8")))
    return keys


def test_画面固定文言が正規形():
    offenders = [(key, text, p) for key, text in UI_TEXT.items() if (p := kanji.validate_ruby_source(text))]
    assert not offenders, "ルビ記法が正規形でない:\n" + "\n".join(
        f"  {key}: {text!r} → {p}" for key, text, p in offenders
    )


@pytest.mark.parametrize("grade", GRADES)
def test_画面固定文言が各学年の配当内(grade):
    texts = ui_text_for(grade)
    assert len(texts) > 50, "文言が集まっていない＝テストが空虚"
    offenders = [(k, t, sorted(bad)) for k, t in texts.items() if (bad := kanji.nonconforming_kanji(t, grade=grade))]
    assert not offenders, f"小{grade} の画面に配当外の漢字: {offenders}"


def test_画面固定文言の読みは学年で変わらない():
    """畳む先はそのルビ自身なので、属性・読み上げは学年によらず同一でなければならない."""
    offenders = []
    for key, text in UI_TEXT.items():
        readings = {kanji.ruby_reading(kanji.open_for_grade(text, g)) for g in GRADES}
        if len(readings) != 1:
            offenders.append((key, sorted(readings)))
    assert not offenders, f"学年で読みが変わる文言: {offenders}"


def test_学年が上がると漢字は減らない():
    offenders = []
    for key, text in UI_TEXT.items():
        counts = [len(kanji._KANJI_RE.findall(kanji.open_for_grade(text, g))) for g in GRADES]
        if counts != sorted(counts):
            offenders.append((key, counts))
    assert not offenders, f"学年が上がって漢字が減る文言: {offenders}"


def test_プレースホルダは学年で変わらない():
    """開きで {name} が壊れると、画面に生の {name} が出る（フロントの fmt が埋められない）."""
    placeholder = re.compile(r"\{(\w+)\}")
    offenders = []
    for key, text in UI_TEXT.items():
        sets = {tuple(sorted(placeholder.findall(kanji.open_for_grade(text, g)))) for g in GRADES}
        if len(sets) != 1 or sets != {tuple(sorted(placeholder.findall(text)))}:
            offenders.append((key, sorted(sets)))
    assert not offenders, f"学年でプレースホルダが変わる文言: {offenders}"


def test_画面が参照するキーが文言表に全部ある():
    """typo（画面 → 表に無い）と死にエントリ（表 → 誰も使わない）の両方を落とす."""
    referenced = _referenced_keys()
    assert len(referenced) > 50, "参照が集まっていない＝テストが空虚（フロントの書きかたが変わった？）"
    missing = sorted(referenced - set(UI_TEXT))
    unused = sorted(set(UI_TEXT) - referenced)
    assert not missing, f"画面が参照しているのに ui_text.py に無いキー: {missing}"
    assert not unused, f"ui_text.py にあるのに画面が使っていないキー: {unused}"


@pytest.mark.parametrize("grade", GRADES)
def test_1日の最大点はサーバ側で差し替える(grade):
    """{score_max} は子どもごと（100＋項目数×25）。数字を直に書くと項目数を変えた子で嘘になる.

    差し替えるのは {limit} と同じ理由＝更新前に開いたままの端末に生の記法を出さないため。
    """
    assert "{score_max}" in ui_text_for(grade)["challenge_all"]  # 引数なしは記法のまま
    filled = ui_text_for(grade, score_max=150)["challenge_all"]
    assert "150" in filled and "{score_max}" not in filled


# ---- テレビタイマーの上限ラベル（子どもごとに変わるので UI_TEXT に書けない） ----

# 1分刻みで全部は回さない。境界（最小・最大）と繰り上がり・ちょうどの時間を代表に取る
_LIMIT_MINUTES = (1, 30, 45, 59, 60, 61, 90, 120, 599, 600, MEDIA_LIMIT_MINUTES_MAX)


@pytest.mark.parametrize("grade", GRADES)
@pytest.mark.parametrize("minutes", _LIMIT_MINUTES)
def test_上限ラベルが各学年の配当内(grade, minutes):
    label = media_limit_label(minutes, grade)
    assert not kanji.nonconforming_kanji(label, grade=grade), f"小{grade} の上限ラベルに配当外の漢字: {label}"


@pytest.mark.parametrize("minutes", _LIMIT_MINUTES)
def test_上限ラベルの読みは学年で変わらない(minutes):
    readings = {kanji.ruby_reading(media_limit_label(minutes, g)) for g in GRADES}
    assert len(readings) == 1, f"{minutes}分のラベルの読みが学年でぶれる: {sorted(readings)}"


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        # 「分」の読みは1の位で ぷん／ふん が変わる（いっぷん・さんぷん・よんぷん・
        # ろっぷん・はっぷん・にじゅっぷん…／にふん・ごふん・ななふん・きゅうふん）。
        # 総ルビなので読みは画面に出るし、小1では漢字ごと畳まれて本文になる。
        (1, "1分《ぷん》"),
        (2, "2分《ふん》"),
        (3, "3分《ぷん》"),
        (4, "4分《ぷん》"),
        (5, "5分《ふん》"),
        (6, "6分《ぷん》"),
        (7, "7分《ふん》"),
        (8, "8分《ぷん》"),
        (9, "9分《ふん》"),
        (10, "10分《ぷん》"),
        (20, "20分《ぷん》"),
        (30, "30分《ぷん》"),  # 管理画面のプリセット
        (45, "45分《ふん》"),
        (59, "59分《ふん》"),
        (60, "1時間《じかん》"),  # ちょうどの時間は「0分」を付けない
        (61, "1時間《じかん》1分《ぷん》"),
        (90, "1時間《じかん》30分《ぷん》"),  # 管理画面のプリセット
        (120, "2時間《じかん》"),
        (MEDIA_LIMIT_MINUTES_MAX, "24時間《じかん》"),
    ],
)
def test_上限ラベルの組み立て(minutes, expected):
    assert media_limit_label(minutes, kanji.GRADE_MAX) == expected


def test_6学年の実表示スナップショット():
    """全キー×小1〜小6の実表示を固定する（区切りや show_from の変更が波及したら落ちる）.

    差分そのものがレビュー対象。意図した変更なら tests/ui_text_snapshot.json を更新する。
    """
    expected = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    actual = {str(g): ui_text_for(g) for g in GRADES}
    assert set(expected) == set(actual), "スナップショットの学年が合っていない"
    offenders = []
    for grade in actual:
        for key in sorted(set(expected[grade]) | set(actual[grade])):
            want = expected[grade].get(key)
            got = actual[grade].get(key)
            if want != got:
                offenders.append(f"  小{grade} {key}: 期待={want!r} 実際={got!r}")
    assert not offenders, "画面固定文言の表示が変わった:\n" + "\n".join(offenders)

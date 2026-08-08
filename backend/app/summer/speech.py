"""「きょうやること」読み上げテキストの決定的組み立て（LLM 不使用＝即時・ゼロコスト）。

judge.remaining_today の残り一覧を、子どもに語りかける短い文に整形する。
音声合成・再生はフロントが /api/tts（VOICEVOX）に text を渡して行う。
画面にも同じテキストを表示する（音声と画面の内容ズレを作らない）。

文は「最大漢字＋総ルビ」で書き、子どもの学年に合わせて kanji.open_for_grade() が開く
（読み＝発音は学年によらず同じなので、音声は学年で変わらない）。
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from app.summer.definition import SummerDefinition
from app.summer.judge import RemainingItem
from app.summer.kanji import open_for_grade

# 読み上げで項目名を列挙する上限（長すぎる音声を避ける。画面側は全件表示する）
SPEECH_LIST_MAX = 5

# 定型文（最大漢字＋総ルビ。{} は項目名などの差し込み）
_LINES: dict[str, str] = {
    "away": "今日《きょう》はお出《で》かけの日《ひ》だね。楽《たの》しんでね。",
    "all_done": "今日《きょう》の記録《きろく》と宿題《しゅくだい》は、全部《ぜんぶ》できているよ。すごいね。",
    "habit_daily": "今日《きょう》はまだ、{labels}の 記録《きろく》がないよ。わすれずにやろうね。",
    "one_shot": "夏休《なつやす》みのおわりが近《ちか》いから、{labels}も 進《すす》めようね。",
    "prep": "新学期《しんがっき》のじゅんび、{label}{note}も わすれずにね。",
    "more": "、そのほかも少《すこ》し",
}


def _join_labels(items: Sequence[RemainingItem], grade: int) -> str:
    labels = [i.label for i in items[:SPEECH_LIST_MAX]]
    joined = "と、".join(labels)
    if len(items) > SPEECH_LIST_MAX:
        joined += open_for_grade(_LINES["more"], grade)
    return joined


def todo_speech_text(
    day: date, items: Sequence[RemainingItem], definition: SummerDefinition
) -> str:
    """やること残りの読み上げ文（決定的テンプレート）."""
    kana = definition.child_kana
    grade = definition.grade_level

    def line(key: str, **kw: str) -> str:
        """定型文をその学年ぶんだけ開いてから差し込む."""
        return open_for_grade(_LINES[key], grade).format(**kw)

    sentences: list[str] = [f"{kana}さん。"]

    habit_daily = [i for i in items if i.kind in ("habit", "daily")]
    one_shot = [i for i in items if i.kind == "one_shot"]
    prep = [i for i in items if i.kind == "school_start"]

    away = definition.away_label(day)
    if away and definition.in_period(day):
        sentences.append(line("away"))

    if not habit_daily and not one_shot:
        if definition.in_period(day):
            sentences.append(line("all_done"))
    else:
        if habit_daily:
            sentences.append(line("habit_daily", labels=_join_labels(habit_daily, grade)))
        if one_shot:
            sentences.append(line("one_shot", labels=_join_labels(one_shot, grade)))

    for item in prep:
        note = f"（{item.note}）" if item.note else ""
        sentences.append(line("prep", label=item.label, note=note))

    return "".join(sentences)

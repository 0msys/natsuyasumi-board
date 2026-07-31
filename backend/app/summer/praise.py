"""「きょうのがんばり」定型メッセージ（決定的・LLM 不使用）。

スコアは judge.daily_score の決定的採点が正。メッセージはスコア帯×学年帯の
定型バンクから選ぶ。同じ子・同じ日なら常に同じ文（リロードで変わらない）、
日が変わればバリアントが回る——選択は crc32 による安定ハッシュ
（Python 組み込み hash() は PYTHONHASHSEED で変わるため使わない）。

学年帯: low=小1-2 / mid=小3-4 / high=小5-6。各バンクの文はその帯の下限学年の
配当漢字＋総ルビ（漢字《よみ》）で書く（tests が機械照合する）。
方針: できたことをほめる・できなかったことを責めない・やっていない
スペシャルチャレンジには一切ふれない（非対称原則）。
"""

from __future__ import annotations

import zlib
from datetime import date

from app.summer.definition import SummerDefinition
from app.summer.judge import ScoreBreakdown
from app.summer.kanji import grade_band, open_for_grade

# スコア帯（上から順に判定）
BAND_PERFECT_PLUS = "perfect_plus"  # base 100 ＋ チャレンジボーナスあり
BAND_PERFECT = "perfect"  # base 100
BAND_GREAT = "great"  # 80 以上
BAND_GOOD = "good"  # 50 以上
BAND_KEEP_GOING = "keep_going"  # 50 未満（記録はある）
BAND_NOT_YET = "not_yet"  # きょうの記録がまだ1件もない

# 学年帯（口調の単位）は kanji.GRADE_BANDS が単一真実源。
# バンクの文は「最大漢字＋総ルビ」で書き、漢字の開き具合は build_praise の出口で
# kanji.open_for_grade() が子どもの学年に合わせて決める（口調は帯・漢字は学年）。

MESSAGES: dict[str, dict[str, tuple[str, ...]]] = {
    # 小1-2 の口調（やさしく短く）
    "low": {
        "perfect_plus": (
            "満点《まんてん》の上《うえ》に、スペシャルチャレンジまで やったんだね。最高《さいこう》だよ。",
            "全部《ぜんぶ》できて、さらに チャレンジも がんばったね。かっこいいよ。",
            "今日《きょう》は とくべつな一日《いちにち》だね。チャレンジまで ばっちりだよ。",
        ),
        "perfect": (
            "満点《まんてん》だよ。全部《ぜんぶ》できて、本当《ほんとう》に すごいね。",
            "今日《きょう》は 全部《ぜんぶ》 できたね。満点《まんてん》、おめでとう。",
            "満点《まんてん》だ。毎日《まいにち》の 積《つ》み重《かさ》ねが ひかっているよ。",
        ),
        "great": (
            "あと少《すこ》しで 満点《まんてん》だね。よく がんばったよ。",
            "たくさん できたね。この 調子《ちょうし》で いこう。",
            "今日《きょう》も しっかり できているよ。えらいね。",
        ),
        "good": (
            "半分《はんぶん》より 多《おお》く できたね。残《のこ》りも 少《すこ》しずつ やってみよう。",
            "がんばっているね。次《つぎ》は もうひとつ できると いいね。",
            "今日《きょう》の 分《ぶん》も ちゃんと 進《すす》んだよ。だいじょうぶ。",
        ),
        "keep_going": (
            "記録《きろく》を つけられたね。それが 大事《だいじ》だよ。",
            "今日《きょう》は ゆっくりの 日《ひ》だね。明日《あした》も いっしょに がんばろう。",
            "少《すこ》しずつで だいじょうぶ。明日《あした》が 楽《たの》しみだね。",
        ),
        "not_yet": (
            "今日《きょう》は まだ 記録《きろく》が ないよ。できたことから つけてみよう。",
            "チェックは これからだね。ひとつずつ やってみよう。",
        ),
    },
    # 小3-4 の口調
    "mid": {
        "perfect_plus": (
            "満点《まんてん》の上《うえ》に、スペシャルチャレンジまでやりとげたね。すばらしいよ。",
            "全部《ぜんぶ》できて、さらにチャレンジもクリア。かっこいいね。",
            "今日《きょう》はとくべつな一日《いちにち》だね。チャレンジまでばっちりだよ。",
        ),
        "perfect": (
            "満点《まんてん》だよ。全部《ぜんぶ》できて、本当《ほんとう》にすごいね。",
            "今日《きょう》も見事《みごと》に満点《まんてん》。積《つ》み重《かさ》ねが力《ちから》になっているね。",
            "満点《まんてん》、おめでとう。この調子《ちょうし》でいこう。",
        ),
        "great": (
            "あと少《すこ》しで満点《まんてん》だね。よくがんばったよ。",
            "たくさんできたね。この調子《ちょうし》でいこう。",
            "今日《きょう》もしっかりできているよ。すごいね。",
        ),
        "good": (
            "半分《はんぶん》より多《おお》くできたね。残《のこ》りも少《すこ》しずつやってみよう。",
            "がんばっているね。次《つぎ》はもうひとつできるといいね。",
            "今日《きょう》の分《ぶん》もちゃんと進《すす》んだよ。だいじょうぶ。",
        ),
        "keep_going": (
            "記録《きろく》をつけられたね。それが大事《だいじ》な一歩《いっぽ》だよ。",
            "今日《きょう》はゆっくりの日《ひ》だね。明日《あした》もいっしょにがんばろう。",
            "少《すこ》しずつでだいじょうぶ。明日《あした》が楽《たの》しみだね。",
        ),
        "not_yet": (
            "今日《きょう》はまだ記録《きろく》がないよ。できたことからつけてみよう。",
            "チェックはこれからだね。ひとつずつやってみよう。",
        ),
    },
    # 小5-6 の口調（少し大人びた言い回し）
    "high": {
        "perfect_plus": (
            "満点《まんてん》に加《くわ》えてスペシャルチャレンジまで。最高《さいこう》の一日《いちにち》だね。",
            "全部《ぜんぶ》やりきって、さらにチャレンジもクリア。お見事《みごと》。",
            "ここまでやれる日《ひ》はなかなかないよ。今日《きょう》の自分《じぶん》をほめてあげてね。",
        ),
        "perfect": (
            "満点《まんてん》だよ。全部《ぜんぶ》やりきったのは本当《ほんとう》にすごいこと。",
            "今日《きょう》も満点《まんてん》。努力《どりょく》の積《つ》み重《かさ》ねが結果《けっか》に出《で》ているね。",
            "満点《まんてん》、おめでとう。自分《じぶん》に自信《じしん》を持《も》っていいよ。",
        ),
        "great": (
            "満点《まんてん》まであと少《すこ》し。今日《きょう》もよくがんばったね。",
            "しっかり進《すす》んでいるよ。この調子《ちょうし》でいこう。",
            "安定《あんてい》してできているね。すごいことだよ。",
        ),
        "good": (
            "半分《はんぶん》以上《いじょう》できたね。残《のこ》りも少《すこ》しずつ進《すす》めよう。",
            "がんばっているね。明日《あした》はもう一歩《いっぽ》進《すす》めるといいね。",
            "今日《きょう》の分《ぶん》は確実《かくじつ》に進《すす》んだよ。",
        ),
        "keep_going": (
            "記録《きろく》をつけたことが大事《だいじ》な一歩《いっぽ》だよ。",
            "今日《きょう》はゆっくりの日《ひ》だね。明日《あした》また切《き》りかえていこう。",
            "少《すこ》しずつでだいじょうぶ。明日《あした》もあるよ。",
        ),
        "not_yet": (
            "今日《きょう》はまだ記録《きろく》がないよ。できたことからつけてみよう。",
            "チェックはこれからだね。ひとつずつ進《すす》めよう。",
        ),
    },
}

# 点数の一文（帯ごと。{score} を埋める）
SCORE_LINE = {
    "low": "今日《きょう》は {score}点《てん》だよ。",
    "mid": "今日《きょう》は{score}点《てん》だよ。",
    "high": "今日《きょう》は{score}点《てん》だよ。",
}

# チャレンジ加点の一文（{bonus} と {total} を埋める）
CHALLENGE_LINE = {
    "low": "チャレンジで ＋{bonus}点《てん》、全部《ぜんぶ》で {total}点《てん》だよ。",
    "mid": "チャレンジで＋{bonus}点《てん》、全部《ぜんぶ》で{total}点《てん》だよ。",
    "high": "チャレンジで＋{bonus}点《てん》、合計《ごうけい》{total}点《てん》だよ。",
}

# 帰省・旅行の日に足す一文
AWAY_LINE = {
    "low": "お出《で》かけも 楽《たの》しめたかな。",
    "mid": "お出《で》かけの日《ひ》も楽《たの》しめたかな。",
    "high": "お出《で》かけの日《ひ》も楽《たの》しんだね。",
}


def score_band(score: ScoreBreakdown, has_records: bool) -> str:
    """スコア帯の判定（not_yet はきょうの記録が1件もないとき）."""
    if not has_records:
        return BAND_NOT_YET
    if score.score == 100:
        return BAND_PERFECT_PLUS if score.bonus > 0 else BAND_PERFECT
    if score.score >= 80:
        return BAND_GREAT
    if score.score >= 50:
        return BAND_GOOD
    return BAND_KEEP_GOING


def _pick(variants: tuple[str, ...], child: str, day: date) -> str:
    """同じ子・同じ日なら同じ文になる安定選択（日が変わればバリアントが回る）."""
    digest = zlib.crc32(f"{child}|{day.isoformat()}".encode("utf-8"))
    return variants[digest % len(variants)]


def build_praise(
    child: str,
    day: date,
    score: ScoreBreakdown,
    has_records: bool,
    definition: SummerDefinition,
) -> dict:
    """その日の褒めメッセージを組み立てる（決定的。/api/summer/state の comment 欄）."""
    gband = grade_band(definition.grade_level)
    sband = score_band(score, has_records)
    parts: list[str] = []
    if sband != BAND_NOT_YET:
        parts.append(SCORE_LINE[gband].format(score=score.score))
    parts.append(_pick(MESSAGES[gband][sband], child, day))
    if sband == BAND_PERFECT_PLUS:
        parts.append(CHALLENGE_LINE[gband].format(bonus=score.bonus, total=score.total))
    if definition.away_label(day):
        parts.append(AWAY_LINE[gband])
    # 口調は3帯のまま、漢字の開き具合だけ子どもの学年に合わせる（読みは変わらない）
    text = open_for_grade("".join(parts), definition.grade_level)
    return {
        "score": score.score,
        "bonus": score.bonus,
        "total": score.total,
        "band": sband,
        "text": text,
    }

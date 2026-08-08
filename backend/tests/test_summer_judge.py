"""判定・採点（app/summer/judge.py 純関数）の特性化テスト。

edges 窓の境界・全skip禁止・100点満点採点・スペシャルチャレンジ加点・
連続満点ストリーク・ご褒美ランク進捗・やること残りを固定する。
定義はサンプル JSON（docs/examples/2026-はな.json）をパースして使う。
"""

from __future__ import annotations

from datetime import date

import pytest

from app.summer.definition import RewardRank
from app.summer.judge import (
    RemainingItem,
    can_skip,
    daily_score,
    habits_due,
    in_edges_window,
    perfect_streaks,
    remaining_today,
    reward_progress,
)

START = date(2026, 7, 18)
END = date(2026, 8, 31)

HAMIGAKI_ALL = {"hamigaki_asa": "done", "hamigaki_hiru": "done", "hamigaki_yoru": "done"}
# しゅくだいは6項目（音読・日記・計算カード・けんばん・ドリル・自主学習）で50点を按分する
DAILY_ALL = {
    "ondoku": "done",
    "nikki": "done",
    "keisan": "done",
    "kenban": "done",
    "drill": "done",
    "jishu": "done",
}


# ---- edges 窓（はじめ5日間・おわり5日間） ----


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        (date(2026, 7, 17), False),  # 期間前日
        (date(2026, 7, 18), True),  # 初日
        (date(2026, 7, 22), True),  # はじめ5日目
        (date(2026, 7, 23), False),  # 6日目
        (date(2026, 8, 26), False),  # おわり6日前
        (date(2026, 8, 27), True),  # おわり5日目
        (date(2026, 8, 31), True),  # 最終日
        (date(2026, 9, 1), False),  # 始業式
    ],
)
def test_edges窓の境界(day: date, expected: bool):
    assert in_edges_window(day, START, END, 5) is expected


# ---- 全skip禁止（選択宿題） ----


def test_can_skip_最後の1つは不可(definition):
    group = definition.choice_homework[0]
    others = {o.key: "skip" for o in group.options[1:]}
    assert can_skip(group, others, group.options[0].key) is False


def test_can_skip_2つ残っていれば可(definition):
    group = definition.choice_homework[0]
    others = {o.key: "skip" for o in group.options[2:]}
    assert can_skip(group, others, group.options[0].key) is True


def test_can_skip_未定は残りに数える(definition):
    group = definition.choice_homework[0]
    assert can_skip(group, {}, group.options[0].key) is True


# ---- 100点満点採点 ----


def test_score_全部やったら100点_窓外(definition):
    statuses = {**HAMIGAKI_ALL, **DAILY_ALL}
    result = daily_score(statuses, date(2026, 8, 1), definition)
    assert result.score == 100
    assert [p.points for p in result.parts] == [50, 50]  # せいかつ50＋しゅくだい50


def test_score_全部やったら100点_窓内は7習慣(definition):
    statuses = {
        **HAMIGAKI_ALL,
        "hayaoki": "done",
        "asagohan": "done",
        "hayane": "done",
        "outmedia": "done",
        **DAILY_ALL,
    }
    result = daily_score(statuses, date(2026, 7, 18), definition)
    assert result.score == 100
    assert result.parts[0].total == 7  # 窓内は はみがき3＋edges4


def test_score_宿題は全項目が同じ重みで割合按分(definition):
    # 6項目のうち やった数に比例。どの項目を落としても同じだけ下がる
    # （旧「まいにち30点／くりかえし20点」の重み差は廃止した）。
    r1 = daily_score({"keisan": "done"}, date(2026, 8, 1), definition)
    assert r1.parts[1].points == 8 and r1.parts[1].done == 1 and r1.parts[1].total == 6  # 50/6=8.33
    r_ondoku = daily_score({"ondoku": "done"}, date(2026, 8, 1), definition)
    assert r_ondoku.parts[1].points == r1.parts[1].points  # 項目によって重みが変わらない
    r3 = daily_score({"keisan": "done", "drill": "done", "nikki": "done"}, date(2026, 8, 1), definition)
    assert r3.parts[1].points == 25 and r3.parts[1].done == 3
    r6 = daily_score(DAILY_ALL, date(2026, 8, 1), definition)
    assert r6.parts[1].points == 50 and r6.parts[1].done == 6


def test_score_何もしなければ0点(definition):
    result = daily_score({}, date(2026, 8, 1), definition)
    assert result.score == 0


def test_score_やらなかったも0点扱い(definition):
    statuses = {k: "not_done" for k in HAMIGAKI_ALL}
    result = daily_score(statuses, date(2026, 8, 1), definition)
    assert result.parts[0].points == 0


def test_score_部分点は四捨五入(definition):
    # 窓外: 習慣3項目中1つ done → 50*1/3 = 16.67 → 17
    statuses = {"hamigaki_asa": "done", "ondoku": "done"}
    result = daily_score(statuses, date(2026, 8, 1), definition)
    assert result.parts[0].points == 17
    assert result.parts[1].points == 8  # 50*1/6 = 8.33 → 8
    assert result.score == 25


# ---- ラジオ体操（range 窓・cancelable） ----


def test_range窓_ラジオ体操は期間中だけ生活の分母に入る(definition):
    # 期間前（7/20）・期間後（7/25）は記録欄なし＝分母に radio が入らない
    assert "radio_taisou" not in {h.key for h in habits_due(date(2026, 7, 20), definition)}
    assert "radio_taisou" not in {h.key for h in habits_due(date(2026, 7, 25), definition)}
    # 期間中（7/21〜24）は記録欄あり
    for d in (date(2026, 7, 21), date(2026, 7, 24)):
        assert "radio_taisou" in {h.key for h in habits_due(d, definition)}


def test_score_ラジオ体操中止は満点扱いで加点(definition):
    # 7/24 は edges 窓外＝生活の分母は はみがき3＋ラジオ体操1 の4項目。
    h3 = dict(HAMIGAKI_ALL)
    # 中止（cancelled）は done と同点（4/4=満点）＝行けなくても減点しない
    assert daily_score({**h3, "radio_taisou": "cancelled"}, date(2026, 7, 24), definition).parts[0].points == 50
    assert daily_score({**h3, "radio_taisou": "done"}, date(2026, 7, 24), definition).parts[0].points == 50
    # 未記入・やらなかったは加点なし（3/4=37.5→38）
    assert daily_score(h3, date(2026, 7, 24), definition).parts[0].points == 38
    assert daily_score({**h3, "radio_taisou": "not_done"}, date(2026, 7, 24), definition).parts[0].points == 38


# ---- スペシャルチャレンジ（base==100 で解放される +25点ボーナス・最大200点） ----

FULL_100 = {**HAMIGAKI_ALL, **DAILY_ALL}  # 窓外(8/1)で base=100


def test_challenge_base100未満は加点されない(definition):
    # 宿題が1つ足りない（base<100）とチャレンジをやっても bonus 0・total==base
    almost = {**FULL_100, "gakki": "done", "otetsudai": "done", "nikki": "not_done"}
    r = daily_score(almost, date(2026, 8, 1), definition)
    assert r.score < 100
    assert r.bonus == 0
    assert r.total == r.score


def test_challenge_base100で1つにつき25点(definition):
    r0 = daily_score(FULL_100, date(2026, 8, 1), definition)
    assert r0.score == 100 and r0.bonus == 0 and r0.total == 100
    assert r0.challenge_max == 100  # 4項目 × 25
    r2 = daily_score({**FULL_100, "gakki": "done", "otetsudai": "done"}, date(2026, 8, 1), definition)
    assert r2.bonus == 50 and r2.total == 150
    r4 = daily_score(
        {**FULL_100, "gakki": "done", "otetsudai": "done", "eigo": "done", "tairyoku_ch": "done"},
        date(2026, 8, 1),
        definition,
    )
    assert r4.bonus == 100 and r4.total == 200


def test_challenge_満点判定はbase基準のまま(definition):
    # チャレンジで total>100 でも score(base)==100 は不変＝ストリーク・満点スタンプは100基準
    r = daily_score({**FULL_100, "gakki": "done"}, date(2026, 8, 1), definition)
    assert r.score == 100 and r.total == 125


def test_challenge_全項目のdone状態が返る(definition):
    r = daily_score({**FULL_100, "gakki": "done"}, date(2026, 8, 1), definition)
    done_map = {c.key: c.done for c in r.challenges}
    assert done_map == {"gakki": True, "otetsudai": False, "eigo": False, "tairyoku_ch": False}


# ---- きょうやること ----


def _keys(items: tuple[RemainingItem, ...]) -> set[str]:
    return {i.key for i in items}


def test_remaining_未記入だけが残る(definition):
    statuses = {"hamigaki_asa": "done", "hamigaki_hiru": "not_done", "ondoku": "not_done"}
    items = remaining_today(date(2026, 8, 1), statuses, {}, {}, definition)
    keys = _keys(items)
    assert "hamigaki_yoru" in keys  # 未記入 → 残り
    assert "hamigaki_hiru" not in keys  # やらなかった＝記録済み → 残りに出さない
    assert "nikki" in keys and "ondoku" not in keys
    assert "keisan" in keys  # 旧くりかえし宿題も1項目ずつ残りに出る（集約行はもう無い）
    assert "practice_any" not in keys


def test_remaining_新学期じゅんびはdue3日前から(definition):
    # うわばき（8/31 due）は 8/28 から出る
    assert "uwabaki" in _keys(remaining_today(date(2026, 8, 28), {}, {}, {}, definition))
    assert "uwabaki" not in _keys(remaining_today(date(2026, 8, 20), {}, {}, {}, definition))
    # 完了済みは出ない
    done_flags = {"uwabaki": 1}
    assert "uwabaki" not in _keys(remaining_today(date(2026, 8, 28), {}, done_flags, {}, definition))


def test_remaining_終盤は一回もの宿題が出る(definition):
    items = remaining_today(date(2026, 8, 25), {}, {}, {}, definition)
    keys = _keys(items)
    assert "enikki" in keys and "sakuhin" in keys
    # 読書は残冊数ノートつき
    dokusho = [i for i in items if i.key == "dokusho"][0]
    assert dokusho.note == "あと5"
    # skip した任意宿題は出ない
    items_skip = remaining_today(date(2026, 8, 25), {}, {}, {"jiyu_kenkyu": "skip"}, definition)
    assert "jiyu_kenkyu" not in _keys(items_skip)
    # 8月前半はまだ出ない
    assert "enikki" not in _keys(remaining_today(date(2026, 8, 1), {}, {}, {}, definition))


def test_remaining_選択宿題は1つ完了で消える(definition):
    group = definition.choice_homework[0]
    flags = {group.options[0].key: 1}
    assert "sakuhin" not in _keys(remaining_today(date(2026, 8, 25), {}, flags, {}, definition))


# ---- 連続満点ストリーク（スタンプラリー） ----
# days は (score, away, is_today) の列（期間開始→今日。未来日は含めない）


def test_streak_全満点は連続加算():
    info = perfect_streaks([(100, False, False), (100, False, False), (100, False, True)])
    assert (info.perfect_current, info.perfect_best, info.perfect_total) == (3, 3, 3)


def test_streak_100未満の過去日で切断():
    info = perfect_streaks([(100, False, False), (100, False, False), (99, False, False), (100, False, True)])
    assert info.perfect_current == 1
    assert info.perfect_best == 2
    assert info.perfect_total == 3


def test_streak_未記録の過去日で切断():
    info = perfect_streaks([(100, False, False), (None, False, False), (100, False, True)])
    assert (info.perfect_current, info.perfect_best, info.perfect_total) == (1, 1, 2)


def test_streak_おでかけ日は透明でまたいで継続():
    days = [(100, False, False), (None, True, False), (50, True, False), (100, False, True)]
    info = perfect_streaks(days)
    assert (info.perfect_current, info.perfect_best, info.perfect_total) == (2, 2, 2)


def test_streak_おでかけ日でも満点なら数える():
    info = perfect_streaks([(100, False, False), (100, True, False), (100, False, True)])
    assert info.perfect_current == 3


def test_streak_今日の未達未記録はまだ切らない():
    for today_score in (None, 50):
        info = perfect_streaks([(100, False, False), (100, False, False), (today_score, False, True)])
        assert info.perfect_current == 2, f"today={today_score}"
        assert info.perfect_total == 2


def test_streak_空列はゼロ():
    info = perfect_streaks([])
    assert (info.perfect_current, info.perfect_best, info.perfect_total) == (0, 0, 0)


# ---- ご褒美ランク（総積み上げ点数・reward_progress） ----
# ranks は avg 昇順。days_total=45 のときの閾値: C=3600 / B=4500 / A=6750 / S=8100

REWARD_RANKS = (
    RewardRank(key="c", label="ランクC", avg=80),
    RewardRank(key="b", label="ランクB", avg=100),
    RewardRank(key="a", label="ランクA", avg=150),
    RewardRank(key="s", label="ランクS", avg=180),
)
DAYS_TOTAL = 45


def _pad(vals: list[int | None], n: int = DAYS_TOTAL) -> list[int | None]:
    """day_totals を期間全長へ None 埋め（history と同順同長を模す）."""
    return list(vals) + [None] * (n - len(vals))


def test_reward_キャリーフォワードで欠測ギャップを作らない():
    # [100, None, 50]: 未記録の2日目は前日値を持ち越し（100）・3日目で 150
    rp = reward_progress(_pad([100, None, 50]), 3, 2, DAYS_TOTAL, REWARD_RANKS)
    assert rp.cumulative[:4] == (100, 100, 150, None)
    assert rp.total == 150  # cumulative の最終非None値（今日の途中経過を含む）
    assert all(c is None for c in rp.cumulative[3:])  # 今日より先は None


def test_reward_未経過は積み上げなし():
    rp = reward_progress(_pad([]), 0, 0, DAYS_TOTAL, REWARD_RANKS)
    assert rp.total == 0
    assert all(c is None for c in rp.cumulative)
    assert rp.achieved_key is None and rp.pace_key is None and rp.projected_total == 0


def test_reward_達成はしきい値以上_3599対3600():
    below = reward_progress(_pad([3599]), 1, 0, DAYS_TOTAL, REWARD_RANKS)
    assert below.total == 3599 and below.achieved_key is None
    assert below.ranks[0].achieved is False
    at = reward_progress(_pad([3600]), 1, 0, DAYS_TOTAL, REWARD_RANKS)
    assert at.total == 3600 and at.achieved_key == "c"  # ちょうどで達成（>= 判定）
    assert at.ranks[0].achieved is True


def test_reward_複数達成は最大ランク():
    # total=4600 → C(3600)とB(4500)達成・A(6750)未達 → achieved_key=b（昇順の最大）
    rp = reward_progress(_pad([4600]), 1, 0, DAYS_TOTAL, REWARD_RANKS)
    assert [r.achieved for r in rp.ranks] == [True, True, False, False]
    assert rp.achieved_key == "b"


def test_reward_ペースは完了日のみで初日はpaceなし():
    # days_completed=0（初日・今日を除くと完了日ゼロ）→ projected 0・pace None、total には今日を含む
    rp = reward_progress(_pad([50]), 1, 0, DAYS_TOTAL, REWARD_RANKS)
    assert rp.projected_total == 0 and rp.pace_key is None
    assert rp.total == 50


def test_reward_今日の得点はprojectedに影響しない():
    # 完了2日で各200（合計400）。今日(index2)を 0→200 に変えても projected は不変（total だけ動く）
    base = reward_progress(_pad([200, 200, 0]), 3, 2, DAYS_TOTAL, REWARD_RANKS)
    hot = reward_progress(_pad([200, 200, 200]), 3, 2, DAYS_TOTAL, REWARD_RANKS)
    assert base.projected_total == hot.projected_total == 9000  # 400/2×45
    assert base.total == 400 and hot.total == 600  # total は今日を含む＝動く


def test_reward_projectedは四捨五入():
    # completed_sum=1, days_completed=2, days_total=45 → 1/2×45 = 22.5 → 23（round は偶数丸めで 22 になる）
    rp = reward_progress(_pad([0, 1, 0]), 3, 2, DAYS_TOTAL, REWARD_RANKS)
    assert rp.projected_total == 23


def test_reward_paceは到達見込みの最大ランク():
    # 完了2日で合計300 → projected = 300/2×45 = 6750 = ランクA閾値ちょうど → pace_key=a（>= 判定）
    rp = reward_progress(_pad([150, 150, 0]), 3, 2, DAYS_TOTAL, REWARD_RANKS)
    assert rp.projected_total == 6750 and rp.pace_key == "a"

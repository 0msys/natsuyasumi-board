"""判定・採点（純関数のみ。DB・IO に触れない＝特性化テストの対象）。

- edges 窓: 早寝早起き朝ごはん等の記録欄は はじめ n 日間・おわり n 日間のみ
- 採点: 100点満点の決定的採点（せいかつ50＋しゅくだい50）
- remaining: 「きょうやること」の残り列挙（画面・音声読み上げで共用）

statuses は {item_key: 'done'|'not_done'}（キーが無い＝未記入）を受け取る。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from app.summer.definition import (
    STATUS_CANCELLED,
    STATUS_DONE,
    WINDOW_EDGES,
    WINDOW_RANGE,
    ChoiceGroup,
    DailyItem,
    DECISION_SKIP,
    RewardRank,
    SummerDefinition,
)

# 採点の配点（合計100）。区分を増やすときは合計100を保つこと：
# 区分の点数は「その区分の項目を全部やった日」にしか満額にならないので、合計が100未満だと
# どんなに頑張っても base==100 に届かず、満点スタンプ・連続満点ストリーク・スペシャル
# チャレンジの加点（base==100 が条件）が永久に発生しなくなる。
HABITS_MAX = 50
DAILY_MAX = 50

# スペシャルチャレンジ1つあたりの加点（base==100 のときだけ有効）
CHALLENGE_POINTS = 25


def day_score_max(habits: int, daily_homework: int, special_challenges: int) -> int:
    """その定義で1日にとれる最大点（項目数だけで決まる。日付には依存しない）.

    daily_score と同じ組み立て：空の区分は0点固定で、ボーナスは基本点が満点の日にしか
    付かない＝片方でも空なら1日50点が上限になる。画面の「全部できたら◯点」・履歴グラフの
    y軸・ごほうびグラフの上限・ごほうびの到達判定が、この1つの式を共有する
    （別々に書くと、片方だけが空の区分を数え忘れて食い違う）。

    記録欄を出す日を絞った習慣まではここでは見ない（その日に出ている項目が0件なら
    せいかつは0点になるので、日によってはこの値にも届かない）。上限値として使うこと。
    """
    base = (HABITS_MAX if habits else 0) + (DAILY_MAX if daily_homework else 0)
    return base + (CHALLENGE_POINTS * special_challenges if base == HABITS_MAX + DAILY_MAX else 0)


# 新学期じゅんび項目を「やること」に出し始める due 前日数
SCHOOL_START_LEAD_DAYS = 3
# 一回もの宿題を「やること」に出し始める夏休み終了前日数
ONE_SHOT_LEAD_DAYS = 7


@dataclass(frozen=True)
class ScorePart:
    """採点の内訳1区分（せいかつ・しゅくだい）."""

    name: str
    label: str
    points: int
    max_points: int
    done: int
    total: int


@dataclass(frozen=True)
class ScoreChallenge:
    """スペシャルチャレンジ1項目の当日状態（表示・褒めメッセージ材料で共用）."""

    key: str
    label: str
    done: bool


@dataclass(frozen=True)
class ScoreBreakdown:
    """採点結果。score=base(0-100・parts合計)、total=base+bonus。

    満点(Star)・連続満点ストリークは base(score)==100 を基準にする（total は使わない）。
    """

    score: int  # base（せいかつ50＋しゅくだい50）＝満点判定・ストリークの基準
    parts: tuple[ScorePart, ...]
    bonus: int = 0  # スペシャルチャレンジの加点（base==100 のときのみ、else 0）
    total: int = 0  # base + bonus。表示・履歴グラフの基準
    challenges: tuple[ScoreChallenge, ...] = ()  # チャレンジ各項目の当日 done 状態
    challenge_max: int = 0  # CHALLENGE_POINTS × チャレンジ項目数


@dataclass(frozen=True)
class RemainingItem:
    """「きょうやること」の残り1件（画面リスト・音声読み上げで共用）."""

    kind: str  # 'habit' | 'daily' | 'one_shot' | 'school_start'
    key: str
    label: str
    note: str | None = None


def _round_half_up(value: float) -> int:
    """四捨五入（Python 組み込み round は偶数丸めで採点が直感とズレるため）."""
    return int(value + 0.5)


def in_edges_window(day: date, start: date, end: date, n: int = 5) -> bool:
    """early/late 窓（はじめ n 日間・おわり n 日間）に入っているか."""
    return start <= day <= start + timedelta(days=n - 1) or end - timedelta(days=n - 1) <= day <= end


def habit_active_on(habit: DailyItem, day: date, definition: SummerDefinition) -> bool:
    """その習慣にその日 記録欄があるか（window なし=毎日／edges=初終n日／range=指定期間）."""
    if habit.window == WINDOW_EDGES:
        return in_edges_window(day, definition.start, definition.end, definition.card_rules.edges_window_days)
    if habit.window == WINDOW_RANGE:
        return habit.window_start <= day <= habit.window_end
    return True


def _habit_credited(habit: DailyItem, status: str | None) -> bool:
    """その習慣がその日「加点対象」か。やった＝加点、中止（cancelable のみ）＝満点扱いで加点."""
    if status == STATUS_DONE:
        return True
    return bool(habit.cancelable and status == STATUS_CANCELLED)


def habits_due(day: date, definition: SummerDefinition) -> tuple:
    """その日に記録欄がある習慣（はみがきは毎日、edges/range 習慣は窓内のみ）."""
    return tuple(h for h in definition.habits if habit_active_on(h, day, definition))


def can_skip(group: ChoiceGroup, decisions: Mapping[str, str | None], option_key: str) -> bool:
    """選択宿題グループで option_key を「やらない」にできるか。

    skip 後に decision != 'skip' の選択肢（未定含む）が min_required 未満になるなら不可
    ＝「全部やらない」を作らせない判定核。
    """
    remaining = sum(
        1
        for o in group.options
        if (DECISION_SKIP if o.key == option_key else decisions.get(o.key)) != DECISION_SKIP
    )
    return remaining >= group.min_required


def daily_score(statuses: Mapping[str, str], day: date, definition: SummerDefinition) -> ScoreBreakdown:
    """その日の100点満点採点（決定的）。

    せいかつ（当日記録欄がある習慣のみ）50点・しゅくだい50点。どちらも
    「やった数 ÷ 項目数」で按分する＝宿題は全項目が同じ重み。
    未記入と「やらなかった」はどちらも加点なし（区別は表示・音声側で行う）。

    区分が空（項目0件）だとその区分は0点＝その子は base==100 に届かなくなる。
    片方だけ空の定義を作らせないのは admin.validate の責任。
    """
    due = habits_due(day, definition)
    habit_done = sum(1 for h in due if _habit_credited(h, statuses.get(h.key)))
    habit_points = _round_half_up(HABITS_MAX * habit_done / len(due)) if due else 0

    daily_items = definition.daily_homework
    daily_done = sum(1 for i in daily_items if statuses.get(i.key) == STATUS_DONE)
    daily_points = _round_half_up(DAILY_MAX * daily_done / len(daily_items)) if daily_items else 0

    parts = (
        ScorePart(
            name="habits",
            label="せいかつ",
            points=habit_points,
            max_points=HABITS_MAX,
            done=habit_done,
            total=len(due),
        ),
        ScorePart(
            name="daily",
            label="しゅくだい",
            points=daily_points,
            max_points=DAILY_MAX,
            done=daily_done,
            total=len(daily_items),
        ),
    )
    base = sum(p.points for p in parts)

    # スペシャルチャレンジ: base==100（宿題を全部やった）ときだけ 1つ +25点。
    # base 未満のときは done でも加点しない（＝画面のロックと二重の担保）。
    challenges = tuple(
        ScoreChallenge(key=c.key, label=c.label, done=statuses.get(c.key) == STATUS_DONE)
        for c in definition.special_challenges
    )
    challenge_done = sum(1 for c in challenges if c.done)
    bonus = CHALLENGE_POINTS * challenge_done if base == 100 else 0
    return ScoreBreakdown(
        score=base,
        parts=parts,
        bonus=bonus,
        total=base + bonus,
        challenges=challenges,
        challenge_max=CHALLENGE_POINTS * len(definition.special_challenges),
    )


@dataclass(frozen=True)
class StreakInfo:
    """満点スタンプの集計（履歴グリッドのスタンプラリー表示用）."""

    perfect_current: int  # 今日までの連続満点日数（今日が未達・未記録でもまだ切らない）
    perfect_best: int  # 期間内の最長連続満点日数
    perfect_total: int  # 満点日の合計（集めたスタンプの数）


def perfect_streaks(days: Sequence[tuple[int | None, bool, bool]]) -> StreakInfo:
    """連続満点ストリークの集計（期間開始→今日の (score, away, is_today) 列。未来日は渡さない）.

    - score==100 は加算（おでかけ日でも満点なら数える）
    - おでかけ日・今日の 100 未満/未記録（score=None）は「透明」＝切らず数えず
      （おでかけを責めない・今日はまだ途中で夕方に切れて見せない）
    - それ以外の過去日の 100 未満/未記録は切断（過去日修正で直せば「つながる」）
    """
    current = best = total = 0
    for score, away, is_today in days:
        if score == 100:
            current += 1
            total += 1
            best = max(best, current)
        elif away or is_today:
            continue
        else:
            current = 0
    return StreakInfo(perfect_current=current, perfect_best=best, perfect_total=total)


@dataclass(frozen=True)
class RewardRankState:
    """ご褒美ランク1段の当日状態（threshold=avg×days_total を導出済み・achieved 判定つき）."""

    key: str
    label: str
    avg: int
    threshold: int  # 到達に必要な総積み上げ点数（avg × days_total）
    prize: str | None
    achieved: bool  # total >= threshold（今日の途中経過を含む＝当日その場で成立）


@dataclass(frozen=True)
class RewardProgress:
    """総積み上げ点数によるご褒美ランクの進捗（専用グラフ＋ヘッダチップの単一真実源）.

    - total: 今日までの積み上げ合計（今日の途中経過を含む）
    - cumulative: history と同順同長の積み上げ推移（未記録日は前日値キャリーフォワード＝
      欠測ギャップなし・単調非減少）。未来日（今日より先）は None
    - ranks: 各ランクの閾値・達成状態
    - achieved_key: 達成中の最大ランク（未達なら None）
    - pace_key: 今日を除いた完了日ペースで到達見込みの最大ランク（days_completed==0 なら None）
    - projected_total: 完了日ペースを期間全体へ引き伸ばした予測総点（今日を除外して安定化）
    """

    total: int
    cumulative: tuple[int | None, ...]
    ranks: tuple[RewardRankState, ...]
    achieved_key: str | None
    pace_key: str | None
    projected_total: int


def reward_progress(
    day_totals: Sequence[int | None],
    days_recorded_until: int,
    days_completed: int,
    days_total: int,
    ranks: Sequence[RewardRank],
) -> RewardProgress:
    """総積み上げ点数によるご褒美ランクの進捗を計算する（決定的・純関数）.

    day_totals は history と同順同長（期間全日・未来/未記録は None）。
    days_recorded_until=今日を含む経過日数（この位置まで cumulative を出す）、
    days_completed=今日を除く完了日数（ペースの分母・0..days_total クランプ）。
    """
    running = 0
    completed_sum = 0
    cumulative: list[int | None] = []
    for i, dt in enumerate(day_totals):
        if i < days_recorded_until:
            # 未記録日は0加算で前日値キャリーフォワード（積み上げ線にギャップを作らない・単調非減少）
            running += dt or 0
            cumulative.append(running)
        else:
            cumulative.append(None)  # 今日より先＝まだ点が無い
        if i < days_completed:
            completed_sum += dt or 0
    total = running  # cumulative の最終非None値（days_recorded_until==0 なら 0）

    rank_states: list[RewardRankState] = []
    achieved_key: str | None = None
    for r in ranks:
        threshold = r.avg * days_total
        achieved = total >= threshold
        if achieved:
            achieved_key = r.key  # ranks は avg 昇順＝上書きで最大達成ランクが残る
        rank_states.append(
            RewardRankState(
                key=r.key, label=r.label, avg=r.avg, threshold=threshold, prize=r.prize, achieved=achieved
            )
        )

    # ペースは今日を除外して安定化（朝の未記録で暴落しない・ストリークの「今日は透明」と同思想）
    if days_completed <= 0:
        projected_total = 0
    else:
        projected_total = _round_half_up(completed_sum / days_completed * days_total)
    pace_key: str | None = None
    for r in ranks:
        if projected_total >= r.avg * days_total:
            pace_key = r.key  # 同じく昇順＝到達見込みの最大ランク

    return RewardProgress(
        total=total,
        cumulative=tuple(cumulative),
        ranks=tuple(rank_states),
        achieved_key=achieved_key,
        pace_key=pace_key,
        projected_total=projected_total,
    )


def remaining_today(
    day: date,
    statuses: Mapping[str, str],
    flag_values: Mapping[str, int],
    decisions: Mapping[str, str | None],
    definition: SummerDefinition,
) -> tuple[RemainingItem, ...]:
    """「きょうやること」の残り（未記入の習慣・宿題、間近の新学期じゅんび）.

    3値のうち「やらなかった」は記録済み＝消し込み済みとして残りに含めない。
    夏休み期間外でも school_start（新学期じゅんび）は due ベースで出す。
    """
    items: list[RemainingItem] = []

    if definition.in_period(day):
        for habit in habits_due(day, definition):
            if habit.key not in statuses:
                items.append(RemainingItem(kind="habit", key=habit.key, label=habit.label, note="きろくしよう"))
        for hw in definition.daily_homework:
            if hw.key not in statuses:
                items.append(RemainingItem(kind="daily", key=hw.key, label=hw.label))
        # 夏休みの終わりが近づいたら、終わっていない一回もの宿題も出す
        if (definition.end - day).days <= ONE_SHOT_LEAD_DAYS:
            for item in definition.one_shot_homework:
                if decisions.get(item.key) == DECISION_SKIP:
                    continue
                value = flag_values.get(item.key, 0)
                if item.type == "count":
                    target = item.target or 1
                    if value < target:
                        items.append(
                            RemainingItem(kind="one_shot", key=item.key, label=item.label, note=f"あと{target - value}")
                        )
                elif value < 1:
                    items.append(RemainingItem(kind="one_shot", key=item.key, label=item.label))
            # えらぶ宿題は「どれか min_required 個以上」なので、件数で見る。
            # 1つでも done なら消す書きかたにすると、2つ必要な設定で1つ終えた時点で
            # 残りから消え、宿題カード（satisfied）と言うことが食い違う。
            for group in definition.choice_homework:
                done = sum(1 for o in group.options if flag_values.get(o.key, 0) >= 1)
                if done < group.min_required:
                    items.append(
                        RemainingItem(
                            kind="one_shot",
                            key=group.key,
                            label=group.label,
                            note=f"あと{group.min_required - done}",
                        )
                    )

    for prep in definition.school_start_items:
        if flag_values.get(prep.key, 0) >= 1:
            continue
        if (prep.due - day).days <= SCHOOL_START_LEAD_DAYS:
            items.append(
                RemainingItem(
                    kind="school_start",
                    key=prep.key,
                    label=prep.label,
                    note=f"{prep.due.month}/{prep.due.day}まで",
                )
            )

    return tuple(items)

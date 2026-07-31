"""画面 state の組み立てと書き込み検証（definition＋store＋judge を束ねる層）。

読み取り: build_state() が画面表示に必要な全情報（今日のチェック・履歴・進捗・
採点・褒めメッセージ・やること残り）を JSON 化しやすい dict で返す。
書き込み: set_check / toggle_flag / set_count / set_decision が definition と照合して
検証し、不正は SummerWriteError(status_code, detail) で返す（ルーターが HTTPException 化）。
「今日」は JST（datetime.now(JST).date()）を正とする。child は全関数で必須。
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from app.core import JST, WEEKDAYS_JA
from app.summer import judge, kanji, praise, speech, store, ui_text
from app.summer.definition import (
    DECISION_DO,
    DECISION_SKIP,
    MEDIA_LIMIT_MINUTES_DEFAULT,
    META_TYPE_CHOICE,
    META_TYPE_DURATION,
    META_TYPE_TEXT,
    STATUS_CANCELLED,
    STATUS_DONE,
    STATUS_NOT_DONE,
    DailyItem,
    MetaField,
    OneShotItem,
    SummerDefinition,
    SummerDefinitionError,
    load_definition,
)

COUNT_MAX = 99  # カウント型（読書冊数）の上限クランプ
META_TEXT_MAX = 100  # text 型メモの最大文字数（本のだいめい等）
META_DURATION_MAX = 5999  # duration 型メモの最大秒数（99分59秒）


class SummerWriteError(Exception):
    """書き込み検証エラー（status_code と detail を持つ）."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def today_jst():
    return datetime.now(JST).date()


def _one_shot_done(item: OneShotItem, value: int) -> bool:
    if item.type == "count":
        return value >= (item.target or 1)
    return value >= 1


def _meta_fields_dict(item: DailyItem) -> list[dict]:
    """項目のメモ定義を JSON 化（フロントが入力欄を描くための型情報）."""
    return [
        {
            "key": f.key,
            "type": f.type,
            "label": f.label,
            "placeholder": f.placeholder,
            "options": [{"key": o.key, "label": o.label} for o in f.options],
        }
        for f in item.meta
    ]


def build_state(child: str, today=None, db_path: Path | None = None) -> dict:
    """画面の表示状態を一括で組み立てる（/api/summer/state の本体）."""
    if today is None:
        today = today_jst()
    # today を先に決めてから読む: 年が複数あるとき、どの年の定義を出すかは today で決まる
    definition = load_definition(child, db_path=db_path, today=today)
    in_period = definition.in_period(today)

    checks = store.list_checks(child, definition.start, definition.end, db_path=db_path)
    meta_by_day = store.list_meta(child, definition.start, definition.end, db_path=db_path)
    today_statuses = checks.get(today.isoformat(), {})
    today_meta = meta_by_day.get(today.isoformat(), {})
    flags = store.list_flags(child, db_path=db_path)
    flag_values = {k: f.value for k, f in flags.items()}
    decisions = {k: f.decision for k, f in flags.items()}

    habits_out = []
    for habit in definition.habits:
        habits_out.append(
            {
                "key": habit.key,
                "label": habit.label,
                "window": habit.window,
                "window_start": habit.window_start.isoformat() if habit.window_start else None,
                "window_end": habit.window_end.isoformat() if habit.window_end else None,
                "cancelable": habit.cancelable,
                "window_active": judge.habit_active_on(habit, today, definition),
                "status": today_statuses.get(habit.key),
            }
        )

    def _done_days(key: str) -> int:
        return sum(1 for day_checks in checks.values() if day_checks.get(key) == STATUS_DONE)

    daily_out = [
        {
            "key": i.key,
            "label": i.label,
            "status": today_statuses.get(i.key),
            "done_days": _done_days(i.key),
            "meta_fields": _meta_fields_dict(i),
            "meta": today_meta.get(i.key),
        }
        for i in definition.daily_homework
    ]
    practice_out = [
        {
            "key": i.key,
            "label": i.label,
            "status": today_statuses.get(i.key),
            "done_days": _done_days(i.key),
            "meta_fields": _meta_fields_dict(i),
            "meta": today_meta.get(i.key),
        }
        for i in definition.practice_homework
    ]
    # スペシャルチャレンジ（宿題で100点をとると解放されるごほうび枠）。done のみの単純トグル。
    challenges_out = [
        {
            "key": c.key,
            "label": c.label,
            "status": today_statuses.get(c.key),
            "done_days": _done_days(c.key),
        }
        for c in definition.special_challenges
    ]

    one_shot_out = []
    for item in definition.one_shot_homework:
        value = flag_values.get(item.key, 0)
        one_shot_out.append(
            {
                "key": item.key,
                "label": item.label,
                "type": item.type,
                "required": item.required,
                "value": value,
                "target": item.target,
                "done": _one_shot_done(item, value),
                "decision": decisions.get(item.key),
            }
        )

    choice_out = []
    for group in definition.choice_homework:
        options = [
            {
                "key": o.key,
                "label": o.label,
                "category": o.category,
                "decision": decisions.get(o.key),
                "done": flag_values.get(o.key, 0) >= 1,
            }
            for o in group.options
        ]
        choice_out.append(
            {
                "key": group.key,
                "label": group.label,
                "min_required": group.min_required,
                "satisfied": sum(1 for o in options if o["done"]) >= group.min_required,
                "options": options,
            }
        )

    school_start_out = [
        {
            "key": i.key,
            "label": i.label,
            "due": i.due.isoformat(),
            "done": flag_values.get(i.key, 0) >= 1,
        }
        for i in definition.school_start_items
    ]

    # 履歴グリッド: 期間全日（未来日も含む＝グリッドの枠として必要。is_future で描き分け）
    n_edges = definition.card_rules.edges_window_days
    history = []
    streak_days = []  # 期間開始→今日の (score, away, is_today)。perfect_streaks へ渡す
    day_totals: list[int | None] = []  # history と同順同長の日別 total（reward_progress へ渡す）
    day = definition.start
    while day <= definition.end:
        day_s = day.isoformat()
        statuses = checks.get(day_s, {})
        is_future = day > today
        away_label = definition.away_label(day)
        # 日別スコア: 未来日と「なにも記録がない日」は None（未記録を0点に潰さない＝グラフは欠測）。
        # score=base(満点Star・ストリークの基準・0-100)、total=チャレンジ込み(グラフ数値)。
        sb = judge.daily_score(statuses, day, definition) if statuses and not is_future else None
        day_score = sb.score if sb else None
        day_total = sb.total if sb else None
        day_totals.append(day_total)  # 同順同長を構造的に保証（history と同じループで収集）
        if not is_future:
            streak_days.append((day_score, bool(away_label), day == today))
        history.append(
            {
                "day": day_s,
                "weekday": WEEKDAYS_JA[day.weekday()],
                "statuses": statuses,
                "meta": meta_by_day.get(day_s, {}),
                "away": away_label,
                "edges_window": judge.in_edges_window(day, definition.start, definition.end, n_edges),
                "is_future": is_future,
                "is_today": day == today,
                "score": day_score,
                "total": day_total,
            }
        )
        day += timedelta(days=1)
    streaks = judge.perfect_streaks(streak_days)

    score = judge.daily_score(today_statuses, today, definition) if in_period else None
    remaining = judge.remaining_today(today, today_statuses, flag_values, decisions, definition)

    days_total = (definition.end - definition.start).days + 1
    days_elapsed = min(max((today - definition.start).days + 1, 0), days_total)

    # ご褒美ランク（総積み上げ点数）。定義に rewards が無ければ None＝フロントはカード非表示。
    score_max = 100 + judge.CHALLENGE_POINTS * len(definition.special_challenges)
    rewards_out = None
    if definition.rewards:
        # ペース分母は今日を除く経過日数（today と start が同日なら 0）。0..days_total にクランプ。
        days_completed = min(max((today - definition.start).days, 0), days_total)
        rp = judge.reward_progress(
            day_totals, days_elapsed, days_completed, days_total, definition.rewards
        )
        rewards_out = {
            "total": rp.total,
            "cumulative": list(rp.cumulative),
            "ranks": [
                {
                    "key": r.key,
                    "label": r.label,
                    "avg": r.avg,
                    "threshold": r.threshold,
                    "prize": r.prize,
                    "achieved": r.achieved,
                }
                for r in rp.ranks
            ],
            "achieved_key": rp.achieved_key,
            "pace_key": rp.pace_key,
            "projected_total": rp.projected_total,
            "max_total": score_max * days_total,  # フロントにハードコードさせない
        }

    return {
        "child": child,
        "child_kana": definition.child_kana,
        "grade": definition.grade,
        "grade_level": definition.grade_level,
        # 画面の固定文言。学年ごとに漢字の開き具合だけが変わる（読みは全学年で同じ）。
        # テレビタイマーの {limit} だけはここで実値へ差し替える（更新前に開いたままの
        # 端末に生の「{limit}」を出さないため。ui_text_for の但し書き参照）。
        "ui": ui_text.ui_text_for(
            definition.grade_level, media_limit_minutes=definition.media_timer.limit_minutes
        ),
        "today": today.isoformat(),
        "in_period": in_period,
        "period": {
            "start": definition.start.isoformat(),
            "end": definition.end.isoformat(),
            "first_day_of_school": definition.first_day_of_school.isoformat(),
        },
        "away_today": definition.away_label(today),
        "away": [{"start": a.start.isoformat(), "end": a.end.isoformat(), "label": a.label} for a in definition.away],
        "habits": habits_out,
        "daily_homework": daily_out,
        "practice_homework": practice_out,
        "special_challenges": challenges_out,
        "score_max": score_max,
        "rewards": rewards_out,
        "one_shot": one_shot_out,
        "choice_groups": choice_out,
        "school_start_items": school_start_out,
        # 「今日カードにぬる色」を消したあとの互換スタブ。子ども画面は 60 秒ごとに state を
        # 取り直すので、更新前に開いたままのタブレットは古い JS のまま新しい state を受け取る。
        # 旧画面は `guide === null` で期間外を描き分けるため、キーごと消すと undefined が
        # else 枝に落ちて guide.rows で落ちる（＝リロードするまで真っ白）。null なら
        # 空のカードが1枚出るだけで済む。全端末を1回リロードしたらこの行は消してよい。
        "card_guide": None,
        "history": history,
        "streaks": {
            "perfect_current": streaks.perfect_current,
            "perfect_best": streaks.perfect_best,
            "perfect_total": streaks.perfect_total,
        },
        "today_score": (
            {
                "score": score.score,  # base(0-100)＝満点花火・ストリークの基準
                "bonus": score.bonus,
                "total": score.total,  # base + ボーナス＝見出し数字・虹色/王冠の基準
                "unlocked": score.score == 100,  # チャレンジ枠のロック解除条件
                "challenge_done": sum(1 for c in score.challenges if c.done),
                "challenge_max": score.challenge_max,
                "parts": [
                    {
                        "name": p.name,
                        "label": p.label,
                        "points": p.points,
                        "max_points": p.max_points,
                        "done": p.done,
                        "total": p.total,
                    }
                    for p in score.parts
                ],
            }
            if score
            else None
        ),
        "remaining_today": [
            {"kind": r.kind, "key": r.key, "label": r.label, "note": r.note} for r in remaining
        ],
        # 褒めメッセージ（定型・決定的）。期間外は None＝フロントはカード非表示。
        "comment": (
            praise.build_praise(child, today, score, bool(today_statuses), definition) if score else None
        ),
        "progress": {"days_elapsed": days_elapsed, "days_total": days_total},
    }


def build_todo_speech(child: str, today=None, db_path: Path | None = None) -> dict:
    """「きょうやること」読み上げテキスト（/api/summer/todo-speech の本体。決定的）."""
    if today is None:
        today = today_jst()
    definition = load_definition(child, db_path=db_path, today=today)
    statuses = store.list_checks(child, today, today, db_path=db_path).get(today.isoformat(), {})
    flags = store.list_flags(child, db_path=db_path)
    flag_values = {k: f.value for k, f in flags.items()}
    decisions = {k: f.decision for k, f in flags.items()}
    remaining = judge.remaining_today(today, statuses, flag_values, decisions, definition)
    return {
        "day": today.isoformat(),
        "text": speech.todo_speech_text(today, remaining, definition),
        "remaining": [{"kind": r.kind, "key": r.key, "label": r.label, "note": r.note} for r in remaining],
    }


# ---- アウトメディア視聴タイマー（採点と独立の専用テーブル・毎日0） ----


def _media_rules(child: str, db_path: Path | None, today=None) -> tuple[int, int]:
    """その子の上限（分）と学年を返す（定義の media_timer.limit_minutes）.

    タイマーは採点と独立で、定義が壊れている／まだ無い状態でも止めたくないので、
    そのときは既定（2時間・いちばんやさしい表記）に倒す＝ここでは例外にしない。

    倒すのは SummerDefinitionError＝「定義が無い・壊れている」だけ。DB が読めない等の
    サーバ側の障害まで既定にすり替えると、上限の設定が効いていないのに正常に見える
    （親には気づけない）。それらは 500 として出す。壊れた定義がここへ素の ValueError 等で
    届かないことは parse_definition 側が保証する。
    """
    try:
        definition = load_definition(child, db_path=db_path, today=today)
    except SummerDefinitionError:
        return MEDIA_LIMIT_MINUTES_DEFAULT, kanji.GRADE_MIN
    return definition.media_timer.limit_minutes, definition.grade_level


def _media_state_dict(
    row: store.MediaTimerRow | None,
    child: str,
    day_s: str,
    now: int,
    limit_minutes: int,
    grade_level: int,
) -> dict:
    """視聴タイマー行を画面用 state へ整形する（server_now を含めクライアントが補間する）."""
    if row is None:
        accumulated = 0
        running = False
        resumed_at = None
    else:
        accumulated = row.accumulated_seconds
        running = row.running
        resumed_at = row.resumed_at
    elapsed = accumulated + ((now - resumed_at) if running and resumed_at is not None else 0)
    elapsed = max(0, elapsed)
    limit_seconds = limit_minutes * 60
    return {
        "child": child,
        "day": day_s,
        "running": running,
        "resumed_at": resumed_at,
        "accumulated_seconds": accumulated,
        "elapsed_seconds": elapsed,
        "server_now": now,
        "limit_seconds": limit_seconds,
        # 上限の表示文字列（その子の学年で開いたルビ記法）。画面が「2時間」を
        # ハードコードしないで済むよう、秒と一緒にサーバから配る。
        "limit_label": ui_text.media_limit_label(limit_minutes, grade_level),
        "over_limit": elapsed >= limit_seconds,
    }


def media_timer_state(child: str, today=None, now: int | None = None, db_path: Path | None = None) -> dict:
    """視聴タイマーの現在 state（/api/summer/media-timer/state の本体）。常に今日（JST）の行."""
    if today is None:
        today = today_jst()
    if now is None:
        now = int(time.time())
    day_s = today.isoformat()
    limit_minutes, grade_level = _media_rules(child, db_path, today=today)
    row = store.get_media_timer(child, day_s, db_path=db_path)
    return _media_state_dict(row, child, day_s, now, limit_minutes, grade_level)


def media_timer_start(child: str, today=None, now: int | None = None, db_path: Path | None = None) -> dict:
    """視聴タイマーを開始/再開して最新 state を返す（今日の行を start）."""
    if today is None:
        today = today_jst()
    if now is None:
        now = int(time.time())
    day_s = today.isoformat()
    limit_minutes, grade_level = _media_rules(child, db_path, today=today)
    store.start_media_timer(child, day_s, now, db_path=db_path)
    row = store.get_media_timer(child, day_s, db_path=db_path)
    return _media_state_dict(row, child, day_s, now, limit_minutes, grade_level)


def media_timer_pause(child: str, today=None, now: int | None = None, db_path: Path | None = None) -> dict:
    """視聴タイマーを一時停止して最新 state を返す（走行区間を accumulated へ畳む）."""
    if today is None:
        today = today_jst()
    if now is None:
        now = int(time.time())
    day_s = today.isoformat()
    limit_minutes, grade_level = _media_rules(child, db_path, today=today)
    store.pause_media_timer(child, day_s, now, db_path=db_path)
    row = store.get_media_timer(child, day_s, db_path=db_path)
    return _media_state_dict(row, child, day_s, now, limit_minutes, grade_level)


# ---- 書き込み（検証つき） ----


def _load_for_write(child: str, db_path: Path | None, today=None) -> SummerDefinition:
    # 定義が壊れている場合も書き込みは 503（サーバ側の問題）として返す
    # today は「どの年の定義に書くか」の決定に使う（読みと同じ年に書く）
    return load_definition(child, db_path=db_path, today=today or today_jst())


def set_check(
    child: str, day_s: str, item_key: str, status: str | None, db_path: Path | None = None
) -> str | None:
    """日次3値記録の書き込み検証＋保存。過去日は許可・未来日と期間外は 400."""
    definition = _load_for_write(child, db_path, today=today_jst())
    try:
        day = datetime.strptime(day_s, "%Y-%m-%d").date()
    except ValueError:
        raise SummerWriteError(400, "ひづけが うまく よめなかったよ") from None
    if item_key not in definition.daily_item_keys():
        raise SummerWriteError(400, "その こうもくが みつからないよ")
    if not definition.in_period(day):
        raise SummerWriteError(400, "なつやすみの きかんじゃ ないひだよ")
    if day > today_jst():
        raise SummerWriteError(400, "まだ さきのひは かけないよ")
    allowed = {STATUS_DONE, STATUS_NOT_DONE, None}
    item = definition.daily_item(item_key)
    if item is not None and item.cancelable:
        allowed.add(STATUS_CANCELLED)  # 中止（雨天等）は cancelable 項目のみ
    if status not in allowed:
        raise SummerWriteError(400, "その きろくは できないみたい")
    return store.set_check_status(child, day, item_key, status, db_path=db_path)


def _find_meta_item(definition: SummerDefinition, item_key: str) -> DailyItem | None:
    """メモを持つ日次項目（daily/practice）を key で探す（無ければ None）."""
    for item in definition.daily_homework + definition.practice_homework:
        if item.key == item_key and item.meta:
            return item
    return None


def _normalize_meta_value(field: MetaField, value: object) -> object | None:
    """メモ1フィールドの値を検証・正規化。空・None は「クリア」を表す None を返す."""
    if value is None:
        return None
    if field.type == META_TYPE_TEXT:
        text = str(value).strip()
        return text[:META_TEXT_MAX] if text else None
    if field.type == META_TYPE_CHOICE:
        choice = str(value)
        if choice == "":
            return None
        if choice not in {o.key for o in field.options}:
            raise SummerWriteError(400, "えらべない ものだよ")
        return choice
    if field.type == META_TYPE_DURATION:
        try:
            seconds = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise SummerWriteError(400, "タイムは すうじで いれてね") from None
        if seconds <= 0:
            return None
        return min(seconds, META_DURATION_MAX)
    raise SummerWriteError(400, "この メモは かけないみたい")


def set_meta(
    child: str, day_s: str, item_key: str, updates: dict, db_path: Path | None = None
) -> dict:
    """日次項目のメモ（本のだいめい・計算タイム等）を検証して既存 meta にマージ保存する.

    「やった」の日にだけ書ける（done 以外は 400）。updates の各フィールドは定義と照合し、
    空値はそのフィールドを消す。過去日は許可・未来日と期間外は 400。
    """
    definition = _load_for_write(child, db_path, today=today_jst())
    item = _find_meta_item(definition, item_key)
    if item is None:
        raise SummerWriteError(400, "この こうもくには メモを かけないよ")
    try:
        day = datetime.strptime(day_s, "%Y-%m-%d").date()
    except ValueError:
        raise SummerWriteError(400, "ひづけが うまく よめなかったよ") from None
    if not definition.in_period(day):
        raise SummerWriteError(400, "なつやすみの きかんじゃ ないひだよ")
    if day > today_jst():
        raise SummerWriteError(400, "まだ さきのひは かけないよ")
    if not isinstance(updates, dict):
        raise SummerWriteError(400, "メモの おくりかたが ちがうみたい")

    current = store.get_check(child, day, item_key, db_path=db_path)
    if current is None or current.status != STATUS_DONE:
        raise SummerWriteError(400, "さきに「やった」にしてから、メモをかいてね")

    field_by_key = {f.key: f for f in item.meta}
    merged = dict(current.meta)
    for key, value in updates.items():
        field = field_by_key.get(key)
        if field is None:
            raise SummerWriteError(400, "しらない メモの こうもくだよ")
        normalized = _normalize_meta_value(field, value)
        if normalized is None:
            merged.pop(key, None)
        else:
            merged[key] = normalized

    meta_json = json.dumps(merged, ensure_ascii=False) if merged else None
    store.set_check_meta(child, day, item_key, meta_json, db_path=db_path)
    return merged


def _find_one_shot(definition: SummerDefinition, item_key: str) -> OneShotItem | None:
    return next((i for i in definition.one_shot_homework if i.key == item_key), None)


def toggle_flag(child: str, item_key: str, db_path: Path | None = None) -> dict:
    """フラグ型項目（一回もの宿題・じゅんび・選択肢）の完了トグル。skip 項目は 400."""
    definition = _load_for_write(child, db_path, today=today_jst())
    one_shot = _find_one_shot(definition, item_key)
    if one_shot is not None and one_shot.type == "count":
        raise SummerWriteError(400, "この こうもくは かずで かぞえるよ")
    if one_shot is None and item_key not in definition.flag_item_keys():
        raise SummerWriteError(400, "その こうもくが みつからないよ")
    flags = store.list_flags(child, db_path=db_path)
    state = flags.get(item_key)
    if state is not None and state.decision == DECISION_SKIP:
        raise SummerWriteError(400, "「やらない」にした ものは できたに できないよ（さきに「やる」に もどしてね）")
    new_value = 0 if (state and state.value >= 1) else 1
    store.set_flag_value(child, item_key, new_value, db_path=db_path)
    return {"value": new_value, "done": new_value >= 1}


def set_count(child: str, item_key: str, value: int, db_path: Path | None = None) -> dict:
    """カウント型項目（読書冊数）の値設定（0〜COUNT_MAX にクランプ）."""
    definition = _load_for_write(child, db_path, today=today_jst())
    item = _find_one_shot(definition, item_key)
    if item is None or item.type != "count":
        raise SummerWriteError(400, "かずで かぞえる こうもく じゃないよ")
    clamped = max(0, min(int(value), COUNT_MAX))
    store.set_flag_value(child, item_key, clamped, db_path=db_path)
    return {"value": clamped, "done": _one_shot_done(item, clamped)}


def set_decision(child: str, item_key: str, decision: str | None, db_path: Path | None = None) -> dict:
    """やる/やらないの意思決定。対象は任意宿題と選択宿題オプションのみ。

    選択宿題グループでは「skip すると残り（未定含む）が min_required 未満」になる skip を
    400 で拒否する＝全部やらない禁止。
    """
    definition = _load_for_write(child, db_path, today=today_jst())
    if decision not in (DECISION_DO, DECISION_SKIP, None):
        raise SummerWriteError(400, "「やる」か「やらない」を えらんでね")

    one_shot = _find_one_shot(definition, item_key)
    group = next(
        (g for g in definition.choice_homework if any(o.key == item_key for o in g.options)),
        None,
    )
    if one_shot is not None:
        if one_shot.required:
            raise SummerWriteError(400, "かならず やる しゅくだいだから「やらない」には できないよ")
    elif group is None:
        raise SummerWriteError(400, "「やる/やらない」を きめられる こうもく じゃないよ")

    if group is not None and decision == DECISION_SKIP:
        flags = store.list_flags(child, db_path=db_path)
        decisions = {k: f.decision for k, f in flags.items()}
        if not judge.can_skip(group, decisions, item_key):
            raise SummerWriteError(400, "どれか1つはえらんでね（ぜんぶ「やらない」にはできないよ）")

    store.set_decision(child, item_key, decision, db_path=db_path)
    return {"decision": decision}

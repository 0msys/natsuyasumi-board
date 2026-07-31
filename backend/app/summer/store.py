"""チェック記録の永続化層（summer_* テーブル）。

- summer_daily_checks: 日次3値記録（行が無い＝未記入。meta=追加メモJSON）
- summer_flags: 一回もの宿題・じゅんび・選択肢の非日次状態（value＋decision）
- summer_media_timer: アウトメディア視聴タイマー（日別累積）

接続は app.db.connect（autocommit・WAL）に集約。DDL の単一真実源は schema.sql。
item_key の妥当性検証は呼び出し側（service/ルーター）が definition と照合して行う。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from app import db as app_db
from app.summer.definition import DECISION_SKIP, STATUS_DONE


@dataclass(frozen=True)
class FlagState:
    """summer_flags の1行分（value=フラグ0/1 or カウント値、decision='do'/'skip'/None）."""

    value: int
    decision: str | None


@dataclass(frozen=True)
class CheckRow:
    """summer_daily_checks の1行分（status＋パース済み meta dict）."""

    status: str
    meta: dict


def _parse_meta(raw: object) -> dict:
    """meta 列（JSON TEXT）を dict へ。NULL・壊れは空 dict（表示・検証で安全側）."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)  # type: ignore[arg-type]
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _day_str(day: date | str) -> str:
    return day.isoformat() if isinstance(day, date) else day


def set_check_status(
    child: str, day: date | str, item_key: str, status: str | None, db_path: Path | None = None
) -> str | None:
    """日次3値記録を書く。status=None は行削除（未記入へ戻す）。書いた status を返す.

    'done' は既存 meta を保持（あとから入力欄で足せる）、'not_done' は meta を消す
    （やらなかった日にメモは残さない）。
    """
    day_s = _day_str(day)
    with app_db.connect(db_path) as conn:
        if status is None:
            conn.execute(
                "DELETE FROM summer_daily_checks WHERE child = ? AND day = ? AND item_key = ?",
                (child, day_s, item_key),
            )
        elif status == STATUS_DONE:
            conn.execute(
                """
                INSERT INTO summer_daily_checks (child, day, item_key, status, checked_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(child, day, item_key)
                DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at
                """,
                (child, day_s, item_key, status, int(time.time())),
            )
        else:  # not_done / cancelled: meta は NULL へ戻す
            conn.execute(
                """
                INSERT INTO summer_daily_checks (child, day, item_key, status, checked_at, meta)
                VALUES (?, ?, ?, ?, ?, NULL)
                ON CONFLICT(child, day, item_key)
                DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, meta = NULL
                """,
                (child, day_s, item_key, status, int(time.time())),
            )
    return status


def get_check(
    child: str, day: date | str, item_key: str, db_path: Path | None = None
) -> CheckRow | None:
    """1件の日次記録（status＋meta）を返す（行が無ければ None）。meta 書き込みの土台."""
    with app_db.connect(db_path) as conn:
        cur = conn.execute(
            "SELECT status, meta FROM summer_daily_checks WHERE child = ? AND day = ? AND item_key = ?",
            (child, _day_str(day), item_key),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return CheckRow(status=row[0], meta=_parse_meta(row[1]))


def set_check_meta(
    child: str, day: date | str, item_key: str, meta_json: str | None, db_path: Path | None = None
) -> None:
    """既存の日次記録行の meta 列を更新する（行が無ければ何もしない＝done 前提は呼び出し側で検証）."""
    with app_db.connect(db_path) as conn:
        conn.execute(
            "UPDATE summer_daily_checks SET meta = ? WHERE child = ? AND day = ? AND item_key = ?",
            (meta_json, child, _day_str(day), item_key),
        )


def list_checks(
    child: str, day_from: date | str, day_to: date | str, db_path: Path | None = None
) -> dict[str, dict[str, str]]:
    """期間内の日次記録を {day: {item_key: status}} で返す（両端含む）."""
    with app_db.connect(db_path) as conn:
        cur = conn.execute(
            """
            SELECT day, item_key, status
            FROM summer_daily_checks
            WHERE child = ? AND day >= ? AND day <= ?
            ORDER BY day ASC
            """,
            (child, _day_str(day_from), _day_str(day_to)),
        )
        result: dict[str, dict[str, str]] = {}
        for day_s, item_key, status in cur.fetchall():
            result.setdefault(day_s, {})[item_key] = status
        return result


def list_meta(
    child: str, day_from: date | str, day_to: date | str, db_path: Path | None = None
) -> dict[str, dict[str, dict]]:
    """期間内の meta を {day: {item_key: メモdict}} で返す（meta が空の行は含めない）."""
    with app_db.connect(db_path) as conn:
        cur = conn.execute(
            """
            SELECT day, item_key, meta
            FROM summer_daily_checks
            WHERE child = ? AND day >= ? AND day <= ? AND meta IS NOT NULL
            """,
            (child, _day_str(day_from), _day_str(day_to)),
        )
        result: dict[str, dict[str, dict]] = {}
        for day_s, item_key, meta in cur.fetchall():
            parsed = _parse_meta(meta)
            if parsed:
                result.setdefault(day_s, {})[item_key] = parsed
        return result


def set_flag_value(child: str, item_key: str, value: int, db_path: Path | None = None) -> int:
    """一回もの・じゅんびの value を書く（decision は保持）。書いた value を返す."""
    with app_db.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO summer_flags (child, item_key, value, decision, updated_at)
            VALUES (?, ?, ?, NULL, ?)
            ON CONFLICT(child, item_key)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (child, item_key, int(value), int(time.time())),
        )
    return int(value)


def set_decision(child: str, item_key: str, decision: str | None, db_path: Path | None = None) -> str | None:
    """やる/やらないの意思決定を書く。'skip' にしたら value も 0 に戻す（完了とskipの同居防止）."""
    with app_db.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO summer_flags (child, item_key, value, decision, updated_at)
            VALUES (?, ?, 0, ?, ?)
            ON CONFLICT(child, item_key)
            DO UPDATE SET decision = excluded.decision,
                          value = CASE WHEN excluded.decision = ? THEN 0 ELSE value END,
                          updated_at = excluded.updated_at
            """,
            (child, item_key, decision, int(time.time()), DECISION_SKIP),
        )
    return decision


def list_flags(child: str, db_path: Path | None = None) -> dict[str, FlagState]:
    """summer_flags を {item_key: FlagState} で返す."""
    with app_db.connect(db_path) as conn:
        cur = conn.execute(
            "SELECT item_key, value, decision FROM summer_flags WHERE child = ?",
            (child,),
        )
        return {row[0]: FlagState(value=int(row[1]), decision=row[2]) for row in cur.fetchall()}


# ---- アウトメディア視聴タイマー（summer_media_timer） ----


@dataclass(frozen=True)
class MediaTimerRow:
    """summer_media_timer の1行分（その子のその日の視聴タイマー状態）.

    elapsed = accumulated_seconds + (running ? now - resumed_at : 0) で都度計算する。
    accumulated_seconds は pause でのみ加算され、減算・ゼロ書き込みは行わない。
    """

    child: str
    day: str
    accumulated_seconds: int
    running: bool
    resumed_at: int | None
    updated_at: int


def get_media_timer(child: str, day: date | str, db_path: Path | None = None) -> MediaTimerRow | None:
    """その子のその日の視聴タイマー行を返す（無ければ None＝まだ一度も start していない）."""
    with app_db.connect(db_path) as conn:
        cur = conn.execute(
            """
            SELECT child, day, accumulated_seconds, running, resumed_at, updated_at
            FROM summer_media_timer WHERE child = ? AND day = ?
            """,
            (child, _day_str(day)),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return MediaTimerRow(
        child=row[0],
        day=row[1],
        accumulated_seconds=int(row[2]),
        running=bool(row[3]),
        resumed_at=int(row[4]) if row[4] is not None else None,
        updated_at=int(row[5]),
    )


def start_media_timer(child: str, day: date | str, now: int, db_path: Path | None = None) -> None:
    """視聴タイマーを開始（一時停止からの再開も同じ）.

    冪等: 1文の原子的 UPSERT で、既に running=1 なら resumed_at を伸ばさない
    （二重 start で計測区間を巻き戻さない）。行が無ければ accumulated=0・running=1 で作る。
    """
    day_s = _day_str(day)
    with app_db.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO summer_media_timer (child, day, accumulated_seconds, running, resumed_at, updated_at)
            VALUES (?, ?, 0, 1, ?, ?)
            ON CONFLICT(child, day) DO UPDATE SET
                resumed_at = CASE WHEN running = 1 THEN resumed_at ELSE excluded.resumed_at END,
                running = 1,
                updated_at = excluded.updated_at
            """,
            (child, day_s, int(now), int(now)),
        )


def pause_media_timer(child: str, day: date | str, now: int, db_path: Path | None = None) -> None:
    """視聴タイマーを一時停止（走行中区間を accumulated へ畳む）.

    冪等: 既に running=0 なら加算 0（二重 pause で二重計上しない）。行が無ければ 0行更新＝何もしない
    （まだ一度も start していない＝経過0のまま）。時計は同一の time.time() 系なので now>=resumed_at。
    """
    with app_db.connect(db_path) as conn:
        conn.execute(
            """
            UPDATE summer_media_timer SET
                accumulated_seconds = accumulated_seconds
                    + CASE WHEN running = 1 AND resumed_at IS NOT NULL
                           THEN MAX(0, ? - resumed_at) ELSE 0 END,
                running = 0,
                resumed_at = NULL,
                updated_at = ?
            WHERE child = ? AND day = ?
            """,
            (int(now), int(now), child, _day_str(day)),
        )

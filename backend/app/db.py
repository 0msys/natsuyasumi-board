"""SQLite 接続とスキーマ適用。DDL の単一真実源は schema.sql。"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.core import DEFAULT_DB_PATH

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
SCHEMA_VERSION = 1


@contextmanager
def connect(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """書き込み可の接続（WAL・busy_timeout・autocommit）."""
    p = db_path or DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema(db_path: Path | None = None) -> None:
    """schema.sql を適用してスキーマを最新化する（冪等・起動時とテストが呼ぶ）."""
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with connect(db_path) as conn:
        conn.executescript(sql)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

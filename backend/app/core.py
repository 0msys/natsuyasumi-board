"""共通定数（タイムゾーン・曜日・データディレクトリ）。"""

from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")
WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"]

# データ置き場（SQLite）。Docker では SUMMER_DATA_DIR=/app/data を明示する。
_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("SUMMER_DATA_DIR") or _REPO_ROOT / "data")
DEFAULT_DB_PATH = DATA_DIR / "summer.db"

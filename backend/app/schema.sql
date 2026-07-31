-- natsuyasumi-board の全テーブル（DDL の単一真実源）。
-- 定義（summer_definitions）と記録（summer_daily_checks / summer_flags / summer_media_timer）を
-- 1つの SQLite に持つ。すべて child 列でスコープされ、複数の子どもを同居できる。

-- 定義ドキュメント（管理画面が読み書きする JSON。形式は app/summer/definition.py が検証）。
-- revision は楽観ロック用（保存のたび +1。PUT は一致必須）。
CREATE TABLE IF NOT EXISTS summer_definitions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    child      TEXT    NOT NULL,
    year       INTEGER NOT NULL,
    doc        TEXT    NOT NULL,          -- 定義 JSON（日付は 'YYYY-MM-DD' 文字列）
    revision   INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS summer_definitions_uniq
    ON summer_definitions(child, year);

-- 定義の保存履歴（誤操作からの復旧用。子ども×年ごとに直近10世代だけ残す）。
CREATE TABLE IF NOT EXISTS summer_definition_history (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    child    TEXT    NOT NULL,
    year     INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    doc      TEXT    NOT NULL,
    saved_at INTEGER NOT NULL
);

-- 日次3値記録（生活習慣・毎日/くりかえし宿題・スペシャルチャレンジ）。
--   行が無い = 未記入。status: 'done' / 'not_done' / 'cancelled'（中止は cancelable 項目のみ）。
--   未記入へ戻す操作は行 DELETE（status に NULL を持たせない）。
--   meta: 追加メモの JSON { field_key: 値 }（status='done' の行にのみ付く）。
CREATE TABLE IF NOT EXISTS summer_daily_checks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    child      TEXT    NOT NULL,
    day        TEXT    NOT NULL,          -- 'YYYY-MM-DD'（JST）
    item_key   TEXT    NOT NULL,
    status     TEXT    NOT NULL,
    checked_at INTEGER NOT NULL,
    meta       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS summer_daily_checks_uniq
    ON summer_daily_checks(child, day, item_key);

-- 一回もの宿題・新学期じゅんび・選択宿題オプションの非日次状態。
--   value:    フラグ型 0/1、カウント型（読書冊数など）は 0〜99。
--   decision: 任意宿題・選択宿題オプションのみ 'do'/'skip'（NULL=未定）。必須項目は常に NULL。
--   選択宿題オプションの item_key は「グループkey.オプションkey」のドット連結。
CREATE TABLE IF NOT EXISTS summer_flags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    child      TEXT    NOT NULL,
    item_key   TEXT    NOT NULL,
    value      INTEGER NOT NULL DEFAULT 0,
    decision   TEXT,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS summer_flags_uniq
    ON summer_flags(child, item_key);

-- アウトメディア（テレビ等）視聴タイマー。日別に累積し毎日 0 から（採点とは独立）。
-- 状態モデル: elapsed = accumulated_seconds + (running ? server_now - resumed_at : 0)
--   accumulated_seconds は pause でのみ加算（減算・ゼロ書き込みのコードパスは作らない）。
CREATE TABLE IF NOT EXISTS summer_media_timer (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    child               TEXT    NOT NULL,
    day                 TEXT    NOT NULL,            -- 'YYYY-MM-DD'（JST）
    accumulated_seconds INTEGER NOT NULL DEFAULT 0,
    running             INTEGER NOT NULL DEFAULT 0,
    resumed_at          INTEGER,                     -- running=1 区間の開始 epoch秒
    updated_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS summer_media_timer_uniq
    ON summer_media_timer(child, day);

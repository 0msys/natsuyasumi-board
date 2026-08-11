"""定義ドキュメントの保存・履歴・改名・利用状況（管理 API の書き込みコア）。

保存は「キー採番 → parse_definition で最終検証 → 楽観ロック付き UPDATE ＋ 履歴退避」を
1トランザクションで行う。DB 上のドキュメントは常にロード可能（検証を通ったものだけ書く）。
item の key は利用者に見せず、ここで自動採番する（ラベル改名でキーは変わらない）。
"""

from __future__ import annotations

import json
import secrets
import time
from datetime import date
from pathlib import Path

from app import db as app_db
from app.summer import definition as summer_definition
from app.summer.definition import SummerDefinitionError, parse_definition, parse_grade

HISTORY_KEEP = 10  # 子ども×年ごとに残す履歴世代数

# 区画ごとのキー接頭辞（choice のオプションはグループとドット連結で保存される）
KEY_PREFIXES = {
    "habits": "h_",
    "daily_homework": "dh_",
    "special_challenges": "sc_",
    "one_shot_homework": "os_",
    "school_start_items": "ss_",
    "choice_homework": "cg_",
    "choice_option": "o_",
    "meta": "m_",
    "meta_option": "mo_",
    "rewards": "r_",
}

_ALPHABET36 = "0123456789abcdefghijklmnopqrstuvwxyz"


class DefinitionStoreError(Exception):
    """保存系の検証エラー（status_code と detail を持つ。ルーターが HTTPException 化）."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _rand_key(prefix: str) -> str:
    return prefix + "".join(secrets.choice(_ALPHABET36) for _ in range(6))


def _fresh_key(prefix: str, used: set[str]) -> str:
    while True:
        key = _rand_key(prefix)
        if key not in used:
            used.add(key)
            return key


def _items(raw: object) -> list:
    """区画を項目の配列として取り出す（配列でなければ空）.

    採番は検証より前に走る（create/save とも assign_keys → parse_definition の順）ので、
    ここで型を確かめないと、壊れた JSON の取り込みが parse_definition の 422 ではなく
    素の TypeError＝500 になる。壊れているかどうかの判定は parse_definition に任せ、
    ここは「採番できる形のものだけ触る」に徹する。
    """
    return raw if isinstance(raw, list) else []


def _collect_keys(doc: dict) -> set[str]:
    """ドキュメント内の既存キーを全区画から集める（採番の衝突回避用・空間は分けない）."""
    keys: set[str] = set()
    for section in ("habits", "daily_homework", "special_challenges",
                    "one_shot_homework", "school_start_items", "rewards"):
        for item in _items(doc.get(section)):
            if isinstance(item, dict) and item.get("key"):
                keys.add(str(item["key"]))
            for field in _items(item.get("meta")) if isinstance(item, dict) else []:
                if isinstance(field, dict) and field.get("key"):
                    keys.add(str(field["key"]))
                for opt in _items(field.get("options")) if isinstance(field, dict) else []:
                    if isinstance(opt, dict) and opt.get("key"):
                        keys.add(str(opt["key"]))
    for group in _items(doc.get("choice_homework")):
        if isinstance(group, dict) and group.get("key"):
            keys.add(str(group["key"]))
        for opt in _items(group.get("options")) if isinstance(group, dict) else []:
            if isinstance(opt, dict) and opt.get("key"):
                keys.add(str(opt["key"]))
    return keys


def assign_keys(doc: dict) -> dict:
    """key が空（None/""/欠落）の項目にサーバ採番のキーを振る（doc を書き換えて返す）.

    ラベルからキーを導出しない（改名でキーを変えたくなる誘惑を作らない）。

    採番の前に旧形式（practice_homework）を畳む＝取り込んだ古い JSON も、この先は
    daily_homework 1本として採番・保存される。
    """
    summer_definition.migrate_doc(doc)
    used = _collect_keys(doc)

    def _fill(items: object, prefix: str) -> None:
        for item in _items(items):
            if isinstance(item, dict) and not item.get("key"):
                item["key"] = _fresh_key(prefix, used)

    _fill(doc.get("habits"), KEY_PREFIXES["habits"])
    _fill(doc.get("daily_homework"), KEY_PREFIXES["daily_homework"])
    _fill(doc.get("special_challenges"), KEY_PREFIXES["special_challenges"])
    _fill(doc.get("one_shot_homework"), KEY_PREFIXES["one_shot_homework"])
    _fill(doc.get("school_start_items"), KEY_PREFIXES["school_start_items"])
    _fill(doc.get("rewards"), KEY_PREFIXES["rewards"])
    for item in _items(doc.get("daily_homework")):
        if isinstance(item, dict):
            _fill(item.get("meta"), KEY_PREFIXES["meta"])
            # choice 型メモの選択肢キー（保存値になる）も採番対象に含める
            for field in _items(item.get("meta")):
                if isinstance(field, dict):
                    _fill(field.get("options"), KEY_PREFIXES["meta_option"])
    for group in _items(doc.get("choice_homework")):
        if isinstance(group, dict) and not group.get("key"):
            group["key"] = _fresh_key(KEY_PREFIXES["choice_homework"], used)
        if isinstance(group, dict):
            _fill(group.get("options"), KEY_PREFIXES["choice_option"])
    return doc


def _resolve_year(child: str, year: int | None, db_path: Path | None) -> int | None:
    """操作対象の年を決める（指定があればそれ・無ければいま画面に出ている年）.

    「今日」は service.today_jst を通して取る（アプリ内で1か所に保つ）。属性参照のまま
    呼ぶのは、テストがそこを差し替えて日付を動かすため（束縛済みの名前だと効かない）。
    """
    if year is not None:
        return year
    from app.summer import service

    return summer_definition.display_year(child, db_path=db_path, today=service.today_jst())


def _walk_keyed(doc: dict):
    """key を持ちうる項目を全区画から順に取り出す（採番・キー剥がしで共用）."""
    for section in ("habits", "daily_homework", "special_challenges",
                    "one_shot_homework", "school_start_items", "rewards"):
        for item in _items(doc.get(section)):
            if not isinstance(item, dict):
                continue
            yield item
            for field in _items(item.get("meta")):
                if not isinstance(field, dict):
                    continue
                yield field
                for opt in _items(field.get("options")):
                    if isinstance(opt, dict):
                        yield opt
    for group in _items(doc.get("choice_homework")):
        if not isinstance(group, dict):
            continue
        yield group
        for opt in _items(group.get("options")):
            if isinstance(opt, dict):
                yield opt


def strip_keys(doc: dict) -> dict:
    """全項目の key を落とす（doc を書き換えて返す）.

    次の assign_keys で新しいキーが振られる＝記録（summer_daily_checks / summer_flags）の
    キー空間が前の定義と分かれる。年をまたいで定義をコピーするときに必ず通す。
    """
    for item in _walk_keyed(doc):
        item.pop("key", None)
    return doc


def get_document(
    child: str, db_path: Path | None = None, year: int | None = None
) -> dict | None:
    """編集用のドキュメントを返す（{child, year, years, revision, updated_at, doc}）.

    year 省略時は「いま子ども画面に出ている年」（display_year）。years には登録されている
    年を全部入れる＝管理画面がどの年を編集中か・ほかに何年ぶんあるかを出せる。
    """
    target = _resolve_year(child, year, db_path)
    if target is None:
        return None
    with app_db.connect(db_path) as conn:
        row = conn.execute(
            "SELECT year, doc, revision, updated_at FROM summer_definitions "
            "WHERE child = ? AND year = ?",
            (child, target),
        ).fetchone()
    if row is None:
        return None
    return {
        "child": child,
        "year": row[0],
        "years": summer_definition.list_definition_years(child, db_path=db_path),
        "revision": row[2],
        "updated_at": row[3],
        # 旧形式で保存されたままの doc も、編集画面には新形式（daily_homework 1本）で渡す。
        # DB は次の保存まで旧形式のままだが、revision は据え置きなので楽観ロックは壊れない。
        "doc": summer_definition.migrate_doc(json.loads(row[1])),
    }


def create_definition(doc: dict, db_path: Path | None = None) -> dict:
    """新しい定義を作成する（ウィザード・インポート共用）。同じ子の同じ年が居れば 409.

    年が違えば同じ子でも作れる（来年ぶん）。記録は summer_flags が (child, item_key) で
    年を持たないため、**別の年の定義は必ず別のキー空間**でなければならない
    （去年の「絵日記できた」が今年も済み扱いになる）。ウィザードと create_next_year は
    キーを持たない doc を渡すので assign_keys が新しいキーを振る。エクスポート JSON の
    インポートだけはキーを持ったまま来るので、ここで**まだ登録されている別の年と
    キーがぶつかるなら**振り直す。
    """
    assign_keys(doc)
    try:
        definition = parse_definition(doc, source=str(doc.get("child", "定義")))
    except SummerDefinitionError as e:
        raise DefinitionStoreError(422, str(e)) from None
    now = int(time.time())
    with app_db.connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            exists = conn.execute(
                "SELECT 1 FROM summer_definitions WHERE child = ? AND year = ?",
                (definition.child, definition.year),
            ).fetchone()
            if exists:
                raise DefinitionStoreError(
                    409, f"「{definition.child}」の{definition.year}年ぶんはもう登録されています"
                )
            # 「別の年が居る」だけで振り直してはいけない。年ごとの削除は記録を残す
            # （画面も「記録は消えません」と約束している）ので、消した年を書き出して
            # おいた JSON から登録しなおす道も、ここを通る。ぶつかってもいないのに
            # 振り直すと、のこしておいた記録は古いキーのまま孤児になり、二度と
            # 結びつかない。ぶつかるとき——まだ登録されている年からコピーした doc
            # ——だけ分ければ足りる。
            #
            # 突き合わせるのは doc に書かれた key ではなく、**記録に載る実効キー**
            # （parse 後）。えらぶ宿題の選択肢だけは形が変わり、"グループ.選択肢" に
            # 連結して summer_flags へ入るので、doc の生の key を並べて比べると、
            # 別の年の "g.o" と同じ文字列を持つ一回もの・じゅんびが素通りする。
            # 日次とフラグは別々に見る（保存先が別なので、またいで同じでも混ざらない）。
            collides = False
            for (raw,) in conn.execute(
                "SELECT doc FROM summer_definitions WHERE child = ? AND year != ?",
                (definition.child, definition.year),
            ):
                try:
                    other = parse_definition(json.loads(raw), source=definition.child)
                except SummerDefinitionError:
                    # 読めない年は、どのキーを使っているか分からない＝分けておく
                    collides = True
                    break
                if definition.daily_item_keys() & other.daily_item_keys():
                    collides = True
                    break
                if definition.flag_item_keys() & other.flag_item_keys():
                    collides = True
                    break
            if collides:
                # まだ登録されている年とキー空間を分ける（上の docstring 参照）
                strip_keys(doc)
                assign_keys(doc)
                definition = parse_definition(doc, source=definition.child)
            conn.execute(
                "INSERT INTO summer_definitions (child, year, doc, revision, updated_at) VALUES (?, ?, ?, 1, ?)",
                (definition.child, definition.year, json.dumps(doc, ensure_ascii=False), now),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    return {"child": definition.child, "year": definition.year, "revision": 1, "doc": doc}


def save_document(
    child: str,
    doc: dict,
    expected_revision: int,
    db_path: Path | None = None,
    year: int | None = None,
) -> dict:
    """ドキュメント全文を置換保存する（採番→検証→楽観ロック→履歴退避を1トランザクション）.

    year は編集していた年（省略時はいま画面に出ている年）。doc の year を書き換えて
    別の年に化けさせることはできない（来年ぶんは create_next_year で作る）。
    """
    assign_keys(doc)
    try:
        definition = parse_definition(doc, source=child)
    except SummerDefinitionError as e:
        raise DefinitionStoreError(422, str(e)) from None
    if definition.child != child:
        raise DefinitionStoreError(400, "child は変更できません（名前の変更は rename を使ってください）")
    target_year = _resolve_year(child, year, db_path)
    now = int(time.time())
    doc_text = json.dumps(doc, ensure_ascii=False)
    with app_db.connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT year, doc, revision FROM summer_definitions WHERE child = ? AND year = ?",
                (child, target_year),
            ).fetchone()
            if row is None:
                raise DefinitionStoreError(404, f"「{child}」の定義がありません")
            year, old_doc, revision = row
            if definition.year != year:
                raise DefinitionStoreError(400, "year は変更できません")
            if revision != expected_revision:
                raise DefinitionStoreError(
                    409, "ほかの画面で変更されています。読み直してから保存してください"
                )
            conn.execute(
                "INSERT INTO summer_definition_history (child, year, revision, doc, saved_at) VALUES (?, ?, ?, ?, ?)",
                (child, year, revision, old_doc, now),
            )
            conn.execute(
                """
                DELETE FROM summer_definition_history
                WHERE child = ? AND year = ? AND id NOT IN (
                    SELECT id FROM summer_definition_history
                    WHERE child = ? AND year = ? ORDER BY id DESC LIMIT ?
                )
                """,
                (child, year, child, year, HISTORY_KEEP),
            )
            conn.execute(
                "UPDATE summer_definitions SET doc = ?, revision = revision + 1, updated_at = ? "
                "WHERE child = ? AND year = ?",
                (doc_text, now, child, year),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    return {"child": child, "year": year, "revision": expected_revision + 1, "doc": doc}


def delete_definition(child: str, db_path: Path | None = None, year: int | None = None) -> None:
    """定義と履歴を削除する（記録 summer_* は残す＝復活登録すれば記録は戻る）.

    year 指定でその年だけ（間違えて作った来年ぶんの取り消し）、省略でその子を全年。
    """
    with app_db.connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if year is None:
                conn.execute("DELETE FROM summer_definitions WHERE child = ?", (child,))
                conn.execute("DELETE FROM summer_definition_history WHERE child = ?", (child,))
            else:
                conn.execute(
                    "DELETE FROM summer_definitions WHERE child = ? AND year = ?", (child, year)
                )
                conn.execute(
                    "DELETE FROM summer_definition_history WHERE child = ? AND year = ?",
                    (child, year),
                )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def _shift_year(iso: str, delta: int) -> str:
    """'YYYY-MM-DD' を delta 年ずらす（2/29 だけは 2/28 に丸める）."""
    day = date.fromisoformat(iso)
    try:
        return day.replace(year=day.year + delta).isoformat()
    except ValueError:
        return day.replace(year=day.year + delta, day=28).isoformat()


def create_next_year(child: str, db_path: Path | None = None) -> dict:
    """いちばん新しい年の定義をひな型に、その翌年ぶんを作る（項目はそのまま・記録は引き継がない）.

    引き継ぐもの: 生活習慣・宿題・チャレンジ・ごほうび・じゅんび・えらぶ宿題の**中身**と、
    テレビタイマーの上限・よみあげの声・「はじめとおわりだけ」の日数。
    引き継がないもの:
      - 記録（キーを振り直すので、去年の「絵日記できた」「読書5冊」は今年に出てこない）
      - おでかけの予定（去年の帰省日程は今年と関係ない。空にする）
    ずらすもの: 期間・始業式・じゅんびの締切・きかん限定の習慣の期間を、すべて1年後の同じ月日へ。
    学年は1つ上げる（小6の次は無いので 400）。
    """
    src = get_document(child, db_path=db_path, year=_latest_year(child, db_path))
    if src is None:
        raise DefinitionStoreError(404, f"「{child}」の定義がありません")
    doc = json.loads(json.dumps(src["doc"]))  # 元を書き換えないよう深いコピー
    try:
        parse_definition(doc, source=f"{child}（{src['year']}年）")
    except SummerDefinitionError as e:
        raise DefinitionStoreError(422, f"元の定義が壊れているのでコピーできません: {e}") from None

    _, level = parse_grade(doc.get("grade"), source=child)
    if level >= 6:
        raise DefinitionStoreError(
            400, "小6の次の学年はありません（このアプリは小学生のなつやすみ用です）"
        )
    doc["grade"] = f"小{level + 1}"
    doc["year"] = int(src["year"]) + 1

    period = doc.get("period")
    if isinstance(period, dict):
        for key in ("start", "end", "first_day_of_school"):
            if isinstance(period.get(key), str):
                period[key] = _shift_year(period[key], 1)
    for item in _items(doc.get("habits")):
        if isinstance(item, dict):
            for key in ("window_start", "window_end"):
                if isinstance(item.get(key), str):
                    item[key] = _shift_year(item[key], 1)
    for item in _items(doc.get("school_start_items")):
        if isinstance(item, dict) and isinstance(item.get("due"), str):
            item["due"] = _shift_year(item["due"], 1)
    doc["away"] = []
    strip_keys(doc)  # 記録のキー空間を年で分ける（去年のチェックを持ち越さない）
    return create_definition(doc, db_path=db_path)


def _latest_year(child: str, db_path: Path | None) -> int | None:
    years = summer_definition.list_definition_years(child, db_path=db_path)
    return years[-1] if years else None


def rename_child(old: str, new: str, db_path: Path | None = None) -> None:
    """子ども名の変更（誤字救済）。定義＋記録3テーブルを1トランザクションで更新する."""
    new = new.strip()
    if not new:
        raise DefinitionStoreError(400, "新しい名前が空です")
    if new == old:
        return
    with app_db.connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            rows = conn.execute(
                "SELECT year, doc FROM summer_definitions WHERE child = ?", (old,)
            ).fetchall()
            if not rows:
                raise DefinitionStoreError(404, f"「{old}」の定義がありません")
            exists = conn.execute(
                "SELECT 1 FROM summer_definitions WHERE child = ?", (new,)
            ).fetchone()
            if exists:
                raise DefinitionStoreError(409, f"「{new}」はもう登録されています")
            for year, doc_text in rows:
                doc = json.loads(doc_text)
                doc["child"] = new
                conn.execute(
                    "UPDATE summer_definitions SET child = ?, doc = ? WHERE child = ? AND year = ?",
                    (new, json.dumps(doc, ensure_ascii=False), old, year),
                )
            for table in ("summer_definition_history", "summer_daily_checks", "summer_flags", "summer_media_timer"):
                conn.execute(f"UPDATE {table} SET child = ? WHERE child = ?", (new, old))  # noqa: S608
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def usage(child: str, db_path: Path | None = None) -> dict[str, int]:
    """item_key → 記録件数（daily_checks の行数 ＋ flags の value>0 or decision あり）.

    項目削除の警告（「◯日ぶんの記録があります」）と orphan 検出に使う。
    """
    counts: dict[str, int] = {}
    with app_db.connect(db_path) as conn:
        for item_key, n in conn.execute(
            "SELECT item_key, COUNT(*) FROM summer_daily_checks WHERE child = ? GROUP BY item_key",
            (child,),
        ).fetchall():
            counts[item_key] = counts.get(item_key, 0) + int(n)
        for item_key, n in conn.execute(
            "SELECT item_key, COUNT(*) FROM summer_flags "
            "WHERE child = ? AND (value > 0 OR decision IS NOT NULL) GROUP BY item_key",
            (child,),
        ).fetchall():
            counts[item_key] = counts.get(item_key, 0) + int(n)
    return counts


def record_day_range(
    child: str, db_path: Path | None = None, year: int | None = None
) -> tuple[str, str] | None:
    """日次記録の (最小日, 最大日)。期間変更の警告（records_outside_period）に使う.

    year 指定でその年の記録だけを見る。年をまたいで持っている子は、指定しないと
    去年の記録が毎回「きかんの外に記録があります」になってしまう。
    """
    with app_db.connect(db_path) as conn:
        if year is None:
            row = conn.execute(
                "SELECT MIN(day), MAX(day) FROM summer_daily_checks WHERE child = ?", (child,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MIN(day), MAX(day) FROM summer_daily_checks "
                "WHERE child = ? AND day LIKE ?",
                (child, f"{year}-%"),
            ).fetchone()
    if row is None or row[0] is None:
        return None
    return (row[0], row[1])


def purge_orphans(child: str, db_path: Path | None = None) -> dict[str, int]:
    """定義に存在しない item_key の記録を物理削除する（明示操作のみ・既定では呼ばれない）.

    キーは**その子の全部の年**の定義から集める。1年ぶんだけで判定すると、年をまたいで
    持っている子の去年の記録が丸ごと orphan に見えて消える（コピーでキーを振り直すので、
    去年のキーは今年の定義には1つも入っていない）。
    どれか1年でも定義が壊れていたら SummerDefinitionError で中止する
    ＝不完全なキー集合のまま消さない。
    """
    years = summer_definition.list_definition_years(child, db_path=db_path)
    if not years:
        raise SummerDefinitionError(f"定義が見つかりません: {child}")
    daily_keys: set[str] = set()
    flag_keys: set[str] = set()
    for target in years:
        entry = get_document(child, db_path=db_path, year=target)
        if entry is None:
            continue
        definition = parse_definition(entry["doc"], source=f"{child}（{target}年）")
        daily_keys |= definition.daily_item_keys()
        flag_keys |= definition.flag_item_keys()
    with app_db.connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            all_daily = {
                r[0]
                for r in conn.execute(
                    "SELECT DISTINCT item_key FROM summer_daily_checks WHERE child = ?", (child,)
                ).fetchall()
            }
            all_flags = {
                r[0]
                for r in conn.execute(
                    "SELECT DISTINCT item_key FROM summer_flags WHERE child = ?", (child,)
                ).fetchall()
            }
            orphan_daily = sorted(all_daily - daily_keys)
            orphan_flags = sorted(all_flags - flag_keys)
            removed_checks = 0
            removed_flags = 0
            for key in orphan_daily:
                cur = conn.execute(
                    "DELETE FROM summer_daily_checks WHERE child = ? AND item_key = ?", (child, key)
                )
                removed_checks += cur.rowcount
            for key in orphan_flags:
                cur = conn.execute(
                    "DELETE FROM summer_flags WHERE child = ? AND item_key = ?", (child, key)
                )
                removed_flags += cur.rowcount
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    return {
        "orphan_daily_keys": len(orphan_daily),
        "orphan_flag_keys": len(orphan_flags),
        "removed_check_rows": removed_checks,
        "removed_flag_rows": removed_flags,
    }

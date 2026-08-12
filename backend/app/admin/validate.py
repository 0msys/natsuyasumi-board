"""定義ドキュメントの全件収集バリデータ（管理画面の UX 層）。

parse_definition（最終ゲート）は最初のエラーで raise するが、こちらは全部の問題を
path つきで集めて返す＝フォームの該当欄にアンカーできる。
「parse_definition が拒む全ケースをこちらも検出する」ことをテストが恒常検査する
（乖離ドリフト防止）。

返り値: {ok, errors: [{path, code, message}], warnings: [{path, code, message, detail}]}
  errors   … 保存できない（PUT は 422）
  warnings … 保存できるが利用者に見せる（配当外漢字・期間中追加・記録つき削除・
             どうやっても届かないごほうびなど）
"""

from __future__ import annotations

from datetime import date

from app.summer import definition as summer_definition
from app.summer import kanji
from app.summer.definition import (
    EDGES_WINDOW_DAYS_DEFAULT,
    EDGES_WINDOW_DAYS_MAX,
    MEDIA_LIMIT_MINUTES_DEFAULT,
    MEDIA_LIMIT_MINUTES_MAX,
    META_TYPES,
    WINDOWS,
)
from app.summer.judge import CHALLENGE_POINTS, DAILY_MAX, HABITS_MAX

_GRADES = ("小1", "小2", "小3", "小4", "小5", "小6")


def _err(errors: list, path: str, code: str, message: str) -> None:
    errors.append({"path": path, "code": code, "message": message})


def _warn(warnings: list, path: str, code: str, message: str, detail: dict | None = None) -> None:
    warnings.append({"path": path, "code": code, "message": message, "detail": detail or {}})


def _is_text(value: object) -> bool:
    """画面に出す名前として使えるか（空でない文字列）。parse_definition の _as_text と同じ判定.

    truthy かどうかだけ見ると 1.5 や [1] や True が「名前あり」として通り、
    parse_definition 側（_as_text は str だけ受ける）と食い違う＝保存できたのに
    子ども画面が 503 になる。
    """
    return isinstance(value, str) and bool(value.strip())


def _int_like(value: object) -> int | None:
    """整数として読めれば その値、読めなければ None（bool・小数は不可）.

    判定と変換を parse_definition の _as_int に揃えるための関数。片方だけが数字文字列
    （"5" や全角"５"）を受けると、「インポートはできるのに管理画面から二度と保存できない」
    定義ができる（保存経路は validate を通り、インポート経路は parse だけを通るため）。
    ズレの向きは両方まずい:
      parse 緩・validate 厳 → 取り込めるのに保存できない（利用者は直しようがない）
      parse 厳・validate 緩 → 保存できたのに子ども画面が 503
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _is_int_like(value: object) -> bool:
    """整数として読めるか（bool・小数は不可）。parse_definition の _as_int と同じ判定."""
    return _int_like(value) is not None


def _list(raw: object) -> list:
    """配列として取り出す（配列でなければ空）。キー収集など、報告しない場所で使う."""
    return raw if isinstance(raw, list) else []


def _entries(errors: list, raw: object, path: str) -> list:
    """区画を「項目の配列」として取り出す。配列でなければ errors に積んで空を返す.

    ここで弾かないと下のループが素の TypeError で落ちる＝「保存せず常に 200 で
    issue を返す」はずの /validate が 500 になる（doc は利用者が貼れる任意の JSON）。
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        _err(errors, path, "type", "項目の配列で書いてください")
        return []
    return raw


def _as_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def _check_date(errors: list, data: dict, key: str, path: str, required: bool = True) -> date | None:
    value = data.get(key)
    if value is None:
        if required:
            _err(errors, f"{path}/{key}", "required", "日付を入れてください")
        return None
    d = _as_date(value)
    if d is None:
        _err(errors, f"{path}/{key}", "date_format", "日付（YYYY-MM-DD）で書いてください")
    return d


def _lint_kanji(
    warnings: list, text: object, path: str, grade_level: int | None, name_exceptions: frozenset[str]
) -> None:
    """表示文字列の配当外漢字を warning に積む（grade が壊れているときは lint しない）."""
    if grade_level is None or not isinstance(text, str) or not text:
        return
    bad = kanji.nonconforming_kanji(text, grade=grade_level, name_exceptions=name_exceptions)
    if bad:
        chars = sorted(bad)
        grades = {c: kanji.grade_of(c) for c in chars}
        parts = []
        for c in chars:
            g = grades[c]
            parts.append(f"「{c}」（{g}年生でならう）" if g else f"「{c}」（小学校ではならわない）")
        _warn(
            warnings,
            path,
            "kanji_grade",
            "まだならっていない漢字があります: " + "、".join(parts),
            {"chars": chars, "grades": grades},
        )


def _daily_section_keys(doc: dict, sections: tuple[str, ...]) -> set[str]:
    keys: set[str] = set()
    for section in sections:
        for item in _list(doc.get(section)):
            if isinstance(item, dict) and item.get("key"):
                keys.add(str(item["key"]))
    return keys


def _flag_space_keys(doc: dict) -> set[str]:
    keys = _daily_section_keys(doc, ("one_shot_homework", "school_start_items"))
    for group in _list(doc.get("choice_homework")):
        if not isinstance(group, dict):
            continue
        gkey = group.get("key")
        for opt in _list(group.get("options")):
            if isinstance(opt, dict) and opt.get("key") and gkey:
                keys.add(f"{gkey}.{opt['key']}")
    return keys


def validate_document(
    doc: dict,
    *,
    prev_doc: dict | None = None,
    usage: dict[str, int] | None = None,
    record_days: tuple[str, str] | None = None,
    today: date | None = None,
) -> dict:
    """全部の問題を集めて返す（書き込みはしない）."""
    errors: list[dict] = []
    warnings: list[dict] = []

    if not isinstance(doc, dict):
        return {"ok": False, "errors": [{"path": "", "code": "type", "message": "定義がマップではありません"}], "warnings": []}
    # 旧形式（practice_homework）の取り込み JSON を新形式で検査する（parse_definition と同じ畳み方）
    summer_definition.migrate_doc(doc)
    if prev_doc is not None:
        summer_definition.migrate_doc(prev_doc)

    # ---- 基本情報 ----
    child = doc.get("child")
    if not _is_text(child):
        _err(errors, "/child", "required", "名前を入れてください")
    year = doc.get("year")
    if year is None:
        _err(errors, "/year", "required", "年（西暦）がありません")
    elif not _is_int_like(year):  # 判定は parse_definition の _as_int と揃える（小数・真偽値は不可）
        _err(errors, "/year", "type", "年は数字で入れてください")

    grade_level: int | None = None
    grade = doc.get("grade")
    if grade not in _GRADES:
        _err(errors, "/grade", "grade", "学年は 小1〜小6 からえらんでください")
    else:
        grade_level = int(str(grade)[1])
    name_exceptions = kanji.name_exceptions_for(str(child or ""))

    # ---- 期間 ----
    start = end = first_day = None
    period = doc.get("period")
    if not isinstance(period, dict):
        _err(errors, "/period", "required", "期間を入れてください")
    else:
        start = _check_date(errors, period, "start", "/period")
        end = _check_date(errors, period, "end", "/period")
        first_day = _check_date(errors, period, "first_day_of_school", "/period")
        if start and end and first_day and not (start < end < first_day):
            _err(errors, "/period", "period_order", "はじまり < おわり < 始業式 の順にしてください")

    # ---- おでかけ ----
    for i, entry in enumerate(_entries(errors, doc.get("away"), "/away")):
        path = f"/away/{i}"
        if not isinstance(entry, dict):
            _err(errors, path, "type", "おでかけの項目が壊れています")
            continue
        a_start = _check_date(errors, entry, "start", path)
        a_end = _check_date(errors, entry, "end", path)
        if a_start and a_end and a_start > a_end:
            _err(errors, path, "period_order", "はじまりがおわりより後になっています")
        if not _is_text(entry.get("label")):
            _err(errors, f"{path}/label", "required", "名前（例: おばあちゃんのいえ）を入れてください")
        _lint_kanji(warnings, entry.get("label"), f"{path}/label", grade_level, name_exceptions)

    # ---- カード規則（「はじめとおわりだけ」の記録欄の日数。区画ごと無ければ既定5日） ----
    card = doc.get("card_rules")
    if card is not None and not isinstance(card, dict):
        _err(errors, "/card_rules", "type", "カードの設定が壊れています")
    elif isinstance(card, dict):
        edges_days = _int_like(card.get("edges_window_days", EDGES_WINDOW_DAYS_DEFAULT))
        if edges_days is None or not (1 <= edges_days <= EDGES_WINDOW_DAYS_MAX):
            _err(
                errors,
                "/card_rules/edges_window_days",
                "type",
                f"日数は 1〜{EDGES_WINDOW_DAYS_MAX} の整数で入れてください",
            )

    # ---- 読み上げの声（区画ごと無ければ既定の話者。VOICEVOX の話者ID） ----
    voice = doc.get("voice")
    if voice is not None and not isinstance(voice, dict):
        _err(errors, "/voice", "type", "こえの設定が壊れています")
    elif isinstance(voice, dict):
        speaker = voice.get("speaker")
        if not isinstance(speaker, int) or isinstance(speaker, bool) or speaker < 0:
            _err(errors, "/voice/speaker", "voice_speaker", "こえは一覧からえらんでください")

    # ---- テレビタイマー（アウトメディアの上限。区画ごと無ければ既定2時間） ----
    media = doc.get("media_timer")
    if media is not None and not isinstance(media, dict):
        _err(errors, "/media_timer", "type", "テレビタイマーの設定が壊れています")
    elif isinstance(media, dict):
        limit_minutes = media.get("limit_minutes", MEDIA_LIMIT_MINUTES_DEFAULT)
        if (
            not isinstance(limit_minutes, int)
            or isinstance(limit_minutes, bool)
            or not (1 <= limit_minutes <= MEDIA_LIMIT_MINUTES_MAX)
        ):
            _err(
                errors,
                "/media_timer/limit_minutes",
                "media_limit",
                f"テレビの時間は 1〜{MEDIA_LIMIT_MINUTES_MAX}分 のあいだで入れてください",
            )

    # ---- 日次セクション（habits / daily / challenges） ----
    def _check_daily_items(section: str) -> None:
        for i, item in enumerate(_entries(errors, doc.get(section), f"/{section}")):
            path = f"/{section}/{i}"
            if not isinstance(item, dict):
                _err(errors, path, "type", "項目が壊れています")
                continue
            if not _is_text(item.get("label")):
                _err(errors, f"{path}/label", "required", "名前を入れてください")
            _lint_kanji(warnings, item.get("label"), f"{path}/label", grade_level, name_exceptions)
            window = item.get("window")
            if window is not None and window not in WINDOWS:
                _err(errors, f"{path}/window", "window", f"window は {'/'.join(WINDOWS)} のいずれかです")
            if window == "range":
                w_start = _check_date(errors, item, "window_start", path)
                w_end = _check_date(errors, item, "window_end", path)
                if w_start and w_end and w_start > w_end:
                    _err(errors, path, "window_order", "きかんのはじまりがおわりより後になっています")
            meta_keys: list[str] = []
            for j, field in enumerate(_entries(errors, item.get("meta"), f"{path}/meta")):
                fpath = f"{path}/meta/{j}"
                if not isinstance(field, dict):
                    _err(errors, fpath, "type", "メモ欄の定義が壊れています")
                    continue
                if field.get("key"):
                    meta_keys.append(str(field["key"]))
                ftype = field.get("type")
                if ftype not in META_TYPES:
                    _err(errors, f"{fpath}/type", "meta_type", f"メモの種類は {'/'.join(META_TYPES)} のいずれかです")
                if ftype == "choice":
                    options = _entries(errors, field.get("options"), f"{fpath}/options")
                    if not options:
                        _err(errors, f"{fpath}/options", "meta_options", "えらぶ式のメモには選択肢が必要です")
                    for k_i, opt in enumerate(options):
                        if not isinstance(opt, dict) or not _is_text(opt.get("label")):
                            _err(errors, f"{fpath}/options/{k_i}", "meta_options", "選択肢に名前が必要です")
                        else:
                            _lint_kanji(warnings, opt.get("label"), f"{fpath}/options/{k_i}/label", grade_level, name_exceptions)
                if "label" in field and not _is_text(field.get("label")):
                    _err(errors, f"{fpath}/label", "required", "メモ欄の名前を入れてください")
                _lint_kanji(warnings, field.get("label"), f"{fpath}/label", grade_level, name_exceptions)
                _lint_kanji(warnings, field.get("placeholder"), f"{fpath}/placeholder", grade_level, name_exceptions)
            if len(meta_keys) != len(set(meta_keys)):
                _err(errors, f"{path}/meta", "key_dup", "メモ欄の key が重複しています")

    for section in ("habits", "daily_homework", "special_challenges"):
        _check_daily_items(section)

    # ---- 採点区分が空（judge.daily_score の配点50+50が片肺になる） ----
    # 空の区分は0点固定なので、片方だけ空にすると満点が50点になり、満点スタンプも
    # 連続満点ストリークもスペシャルチャレンジの加点も永久に出ない。気づけないので警告する。
    for section, other, label in (
        ("habits", "daily_homework", "せいかつ"),
        ("daily_homework", "habits", "しゅくだい"),
    ):
        if not _list(doc.get(section)) and _list(doc.get(other)):
            _warn(
                warnings,
                f"/{section}",
                "empty_score_section",
                f"「{label}」の項目が1つもないと、どんなにがんばっても100点になりません"
                "（満点のスタンプ・れんぞく満点・スペシャルチャレンジが出なくなります）",
            )

    # ---- 一回もの ----
    for i, item in enumerate(_entries(errors, doc.get("one_shot_homework"), "/one_shot_homework")):
        path = f"/one_shot_homework/{i}"
        if not isinstance(item, dict):
            _err(errors, path, "type", "項目が壊れています")
            continue
        if not _is_text(item.get("label")):
            _err(errors, f"{path}/label", "required", "名前を入れてください")
        _lint_kanji(warnings, item.get("label"), f"{path}/label", grade_level, name_exceptions)
        item_type = item.get("type", "flag")
        if item_type not in ("flag", "count"):
            _err(errors, f"{path}/type", "one_shot_type", "しゅるいは flag か count です")
        if item_type == "count":
            target = item.get("target")
            if not isinstance(target, int) or isinstance(target, bool) or target < 1:
                _err(errors, f"{path}/target", "target", "目標の数は1以上の整数で入れてください")

    # ---- 選択宿題 ----
    for i, group in enumerate(_entries(errors, doc.get("choice_homework"), "/choice_homework")):
        path = f"/choice_homework/{i}"
        if not isinstance(group, dict):
            _err(errors, path, "type", "グループが壊れています")
            continue
        if not _is_text(group.get("label")):
            _err(errors, f"{path}/label", "required", "グループの名前を入れてください")
        _lint_kanji(warnings, group.get("label"), f"{path}/label", grade_level, name_exceptions)
        options = _entries(errors, group.get("options"), f"{path}/options")
        if not options:
            _err(errors, f"{path}/options", "required", "選択肢を1つ以上入れてください")
        for j, opt in enumerate(options):
            opath = f"{path}/options/{j}"
            if not isinstance(opt, dict) or not _is_text(opt.get("label")):
                _err(errors, f"{opath}/label", "required", "選択肢の名前を入れてください")
                continue
            _lint_kanji(warnings, opt.get("label"), f"{opath}/label", grade_level, name_exceptions)
            _lint_kanji(warnings, opt.get("category"), f"{opath}/category", grade_level, name_exceptions)
        min_required = _int_like(group.get("min_required", 1))
        if min_required is None:
            _err(errors, f"{path}/min_required", "min_required", "さいてい数は整数で入れてください")
        elif options and not (1 <= min_required <= len(options)):
            _err(errors, f"{path}/min_required", "min_required", f"さいてい数は 1〜{len(options)} にしてください")

    # ---- 新学期じゅんび ----
    for i, item in enumerate(_entries(errors, doc.get("school_start_items"), "/school_start_items")):
        path = f"/school_start_items/{i}"
        if not isinstance(item, dict):
            _err(errors, path, "type", "項目が壊れています")
            continue
        if not _is_text(item.get("label")):
            _err(errors, f"{path}/label", "required", "名前を入れてください")
        _lint_kanji(warnings, item.get("label"), f"{path}/label", grade_level, name_exceptions)
        _check_date(errors, item, "due", path)

    # ---- ごほうびランク ----
    # 1日にとれる最大点。judge.daily_score と同じ組み立てで、空の区分は0点固定・
    # ボーナスは base が満点のときだけ付く＝片方でも空なら1日50点が上限になる
    # （ここを 100+チャレンジ で決め打つと、しゅくだいが空の定義で avg 80 のランクが
    # 「届かないのに無警告」になる）。ランクの到達点は avg × 日数、上限は score_max × 日数で
    # 日数が両辺に等しくかかるので、1日あたりで比べれば足りる＝期間が壊れていても判定できる。
    #
    # これは上限値なので「必ず届かない」ものだけを拾う。記録欄を出す日を絞った習慣のように
    # 日ごとに上限が下がる設定までは見ない（見逃しは許すが、誤検知は出さない）。
    base_max = (HABITS_MAX if _list(doc.get("habits")) else 0) + (
        DAILY_MAX if _list(doc.get("daily_homework")) else 0
    )
    challenge_max = CHALLENGE_POINTS * len(_list(doc.get("special_challenges")))
    score_max = base_max + (challenge_max if base_max == HABITS_MAX + DAILY_MAX else 0)
    prev_avg: int | None = None
    reward_keys: list[str] = []
    for i, rank in enumerate(_entries(errors, doc.get("rewards"), "/rewards")):
        path = f"/rewards/{i}"
        if not isinstance(rank, dict):
            _err(errors, path, "type", "ランクが壊れています")
            continue
        if rank.get("key"):
            reward_keys.append(str(rank["key"]))
        if not _is_text(rank.get("label")):
            _err(errors, f"{path}/label", "required", "ランクの名前を入れてください")
        _lint_kanji(warnings, rank.get("label"), f"{path}/label", grade_level, name_exceptions)
        _lint_kanji(warnings, rank.get("prize"), f"{path}/prize", grade_level, name_exceptions)
        avg = rank.get("avg")
        if not isinstance(avg, int) or isinstance(avg, bool) or avg <= 0:
            _err(errors, f"{path}/avg", "rewards_avg", "1日の平均点は1以上の整数で入れてください")
            continue
        if prev_avg is not None and avg <= prev_avg:
            _err(errors, f"{path}/avg", "rewards_order", "ランクは平均点の小さい→大きい順にしてください")
        prev_avg = avg
        # ちょうど score_max（＝全日満点で到達）は正当な設計なので鳴らさない。超えたときだけ。
        if avg > score_max:
            _warn(
                warnings,
                f"{path}/avg",
                "rewards_unreachable",
                f"1日にとれるのは最大{score_max}点なので、平均{avg}点のこのランクは"
                "毎日ぜんぶできても届きません"
                "（平均点を下げるか、せいかつ・しゅくだい・スペシャルチャレンジの項目を見直してください）",
                {"avg": avg, "score_max": score_max},
            )
    if len(reward_keys) != len(set(reward_keys)):
        _err(errors, "/rewards", "key_dup", "ランクの key が重複しています")

    # ---- キー一意性（日次系と flags 系は別空間） ----
    daily_sections = ("habits", "daily_homework", "special_challenges")
    daily_keys: list[str] = []
    for section in daily_sections:
        for item in _list(doc.get(section)):
            if isinstance(item, dict) and item.get("key"):
                daily_keys.append(str(item["key"]))
    if len(daily_keys) != len(set(daily_keys)):
        _err(errors, "", "key_dup_daily", "習慣・宿題・チャレンジの key が重複しています")
    flag_keys: list[str] = []
    for section in ("one_shot_homework", "school_start_items"):
        for item in _list(doc.get(section)):
            if isinstance(item, dict) and item.get("key"):
                flag_keys.append(str(item["key"]))
    for group in _list(doc.get("choice_homework")):
        if not isinstance(group, dict):
            continue
        gkey = group.get("key")
        for opt in _list(group.get("options")):
            if isinstance(opt, dict) and opt.get("key") and gkey:
                flag_keys.append(f"{gkey}.{opt['key']}")
    if len(flag_keys) != len(set(flag_keys)):
        _err(errors, "", "key_dup_flags", "一回もの・じゅんび・選択肢の key が重複しています")

    # ---- 影響警告（過去の点数の見え方が変わる操作） ----
    if prev_doc is not None and today is not None and start and end and start <= today <= end:
        # 期間中の分母追加（daily は全過去日、habits は窓次第だがまとめて警告）
        prev_keys = _daily_section_keys(prev_doc, ("habits", "daily_homework"))
        for section in ("habits", "daily_homework"):
            for i, item in enumerate(_list(doc.get(section))):
                # key が空＝採番前の新規項目も「期間中の追加」なので警告する（保存前 validate はこの経路）
                if isinstance(item, dict) and (not item.get("key") or str(item["key"]) not in prev_keys):
                    _warn(
                        warnings,
                        f"/{section}/{i}",
                        "mid_period_add",
                        "きかんの途中で足すと、前の日の点数が下がって見えます（きかん限定にできる習慣なら「きかん」を使ってください）",
                    )
    if prev_doc is not None and usage:
        new_daily = _daily_section_keys(doc, daily_sections)
        new_flags = _flag_space_keys(doc)
        prev_daily = _daily_section_keys(prev_doc, daily_sections)
        prev_flags = _flag_space_keys(prev_doc)
        for key in sorted((prev_daily - new_daily) | (prev_flags - new_flags)):
            count = usage.get(key, 0)
            if count > 0:
                _warn(
                    warnings,
                    "",
                    "delete_with_records",
                    f"けした項目に {count}件の記録があります。記録は消えませんが、過去の点数が上がって見えます",
                    {"key": key, "count": count},
                )
    if record_days and start and end:
        min_day, max_day = record_days
        if min_day < start.isoformat() or max_day > end.isoformat():
            _warn(
                warnings,
                "/period",
                "records_outside_period",
                "新しいきかんの外に記録があります（画面には出なくなりますが、記録は消えません）",
                {"min_day": min_day, "max_day": max_day},
            )

    return {"ok": not errors, "errors": errors, "warnings": warnings}

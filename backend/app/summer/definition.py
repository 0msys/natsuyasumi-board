"""定義ドキュメント（summer_definitions の JSON）の検証と dataclass 化。

item の key は DB（summer_daily_checks / summer_flags）の記録キー。運用開始後の
key 変更は履歴が切れるため、管理画面は key を利用者に見せず自動採番する（admin 層）。
定義は小さいのでリクエスト毎に DB から読み直す（キャッシュなし＝保存が即反映）。
パースはステートレス関数のみ（threadpool 並列でも安全）。

日付は JSON のため 'YYYY-MM-DD' 文字列で持つ（date オブジェクトも受ける）。
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from app import db as app_db
from app.core import JST

# 3値記録の status 値（summer_daily_checks.status。行が無い＝未記入）
STATUS_DONE = "done"
STATUS_NOT_DONE = "not_done"
# 中止（雨天等で行事自体が中止）。cancelable な習慣のみ取りうる第4の status。
# 採点上は done と同じ満点扱い（本人の責でないため点を下げない）。
STATUS_CANCELLED = "cancelled"

# habits の window 値（記録欄をいつ出すか）
WINDOW_EDGES = "edges"  # はじめ n 日間・おわり n 日間のみ（はみがきカレンダー準拠）
WINDOW_RANGE = "range"  # window_start〜window_end の期間のみ（ラジオ体操など期間限定行事）
WINDOWS = (WINDOW_EDGES, WINDOW_RANGE)
# やる/やらないの decision 値（summer_flags.decision。NULL＝未定）
DECISION_DO = "do"
DECISION_SKIP = "skip"

# 日次項目に付けられるメモ（summer_daily_checks.meta）のフィールド型
META_TYPE_TEXT = "text"  # 自由記述（本のだいめい など）
META_TYPE_CHOICE = "choice"  # 選択肢から1つ（たしざん/ひきざん など）
META_TYPE_DURATION = "duration"  # 分:秒（整数の秒で保存する。計算カードのタイム など）
META_TYPES = (META_TYPE_TEXT, META_TYPE_CHOICE, META_TYPE_DURATION)

# 学年表記（小1〜小6）。grade_level（int）の導出元
_GRADE_RE = re.compile(r"^小([1-6])$")

# アウトメディア視聴タイマー（テレビ・ゲーム）の1日の上限。子どもごとに変えられる。
# 上限そのものは記録に触れない（超えても採点は変わらず、画面の色と文言が変わるだけ）。
MEDIA_LIMIT_MINUTES_DEFAULT = 120  # 2時間
MEDIA_LIMIT_MINUTES_MAX = 24 * 60  # 1日ぶん（これ以上はタイマーの意味がない）

# window='edges' の記録欄を出す「はじめ／おわり」の日数。
# 0以下だと edges の項目が全日ひっこんで採点の分母が黙って変わり、巨大値だと
# judge.in_edges_window の date 加算が OverflowError（＝子ども画面が 500）になる。
# 夏休みが1年を超えることは無いので 1〜366 に閉じる。
EDGES_WINDOW_DAYS_DEFAULT = 5
EDGES_WINDOW_DAYS_MAX = 366


class SummerDefinitionError(Exception):
    """定義が見つからない・壊れているときに送出（ルーターで 503 に変換）."""


@dataclass(frozen=True)
class MetaOption:
    """choice 型メモの選択肢1つ（key は保存値・label は表示名）."""

    key: str
    label: str


@dataclass(frozen=True)
class MetaField:
    """日次項目に付くメモ1フィールドの定義（type=text/choice/duration）."""

    key: str
    type: str
    label: str
    placeholder: str | None = None
    options: tuple[MetaOption, ...] = ()  # choice のときのみ


@dataclass(frozen=True)
class DailyItem:
    """日次3値記録の項目（habits / daily_homework / practice_homework）."""

    key: str
    label: str
    window: str | None = None  # habits のみ: 'edges'（初終n日）/ 'range'（期間限定）
    window_start: date | None = None  # window='range' のとき記録欄を出す開始日
    window_end: date | None = None  # window='range' のとき記録欄を出す終了日
    cancelable: bool = False  # 中止（雨天等）を記録でき、中止日は満点扱い
    meta: tuple[MetaField, ...] = ()  # daily/practice のみ: 「やった」日に開く追加メモ

    def meta_field(self, key: str) -> MetaField | None:
        return next((f for f in self.meta if f.key == key), None)


@dataclass(frozen=True)
class OneShotItem:
    """一回ものの宿題（required=False は「やる/やらない」decision 対象）."""

    key: str
    label: str
    required: bool
    type: str = "flag"  # 'flag' | 'count'
    target: int | None = None  # count 型のみ（読書5冊なら 5）


@dataclass(frozen=True)
class ChoiceOption:
    """選択宿題の選択肢。key はグループ key とドット連結済み."""

    key: str
    label: str
    category: str | None


@dataclass(frozen=True)
class ChoiceGroup:
    """「どれか min_required 点以上」の選択宿題グループ（全部 skip は不可）."""

    key: str
    label: str
    min_required: int
    options: tuple[ChoiceOption, ...]


@dataclass(frozen=True)
class AwayRange:
    """帰省・旅行など（履歴グリッドで「おでかけ」表示。判定計算は通常どおり）."""

    start: date
    end: date
    label: str

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end


@dataclass(frozen=True)
class SchoolStartItem:
    """新学期のじゅんびチェック項目（due=持っていく日・やる日）."""

    key: str
    label: str
    due: date


@dataclass(frozen=True)
class VoiceSettings:
    """読み上げの声（VOICEVOX の話者＝スタイルID）。子どもごとに変えられる.

    speaker が単一真実源で、label は管理画面の表示用キャッシュ（VOICEVOX が止まっていても
    「だれの声にしてあるか」を出せる）。合成には speaker しか使わない。
    """

    speaker: int
    label: str | None = None


@dataclass(frozen=True)
class RewardRank:
    """ご褒美ランク1段（総積み上げ点数で決まる）.

    avg=1日平均点の目安（単一真実源）。総計の到達閾値 avg×days_total は judge が導出する。
    prize はご褒美の中身を書く任意欄（未定なら None＝ランク名のみ運用）。
    """

    key: str
    label: str
    avg: int
    prize: str | None = None


@dataclass(frozen=True)
class CardRules:
    """紙の「はみがきカレンダー」に合わせた記録欄のルール."""

    edges_window_days: int  # window='edges' の項目を出す はじめ／おわり の日数


@dataclass(frozen=True)
class MediaTimerRules:
    """アウトメディア視聴タイマーの1日の上限（子どもごと・分で持つ）.

    分を単一真実源にする（管理画面の入力も分・秒は表示のたびに導出）。
    """

    limit_minutes: int = MEDIA_LIMIT_MINUTES_DEFAULT

    @property
    def limit_seconds(self) -> int:
        return self.limit_minutes * 60


@dataclass(frozen=True)
class SummerDefinition:
    """定義ドキュメント全体（不変・検証済み）."""

    child: str
    child_kana: str  # 音声読み上げの呼びかけ用（未指定なら child と同じ）
    year: int
    grade: str  # 表示用（小1〜小6）
    grade_level: int  # 1〜6（漢字配当 lint・褒めメッセージの学年帯に使う）
    start: date
    end: date
    first_day_of_school: date
    away: tuple[AwayRange, ...]
    card_rules: CardRules
    habits: tuple[DailyItem, ...]
    daily_homework: tuple[DailyItem, ...]
    practice_homework: tuple[DailyItem, ...]
    one_shot_homework: tuple[OneShotItem, ...]
    choice_homework: tuple[ChoiceGroup, ...]
    school_start_items: tuple[SchoolStartItem, ...]
    # 宿題で100点を取ると解放されるごほうび枠（1つ+25点）。日次done記録だが
    # 採点baseには入らない任意項目。
    special_challenges: tuple[DailyItem, ...] = ()
    # ご褒美ランク（総積み上げ点数で決まる段位。avg 昇順・検証済み）。空なら画面はカード非表示。
    rewards: tuple[RewardRank, ...] = ()
    # 読み上げの声（未設定なら環境変数 VOICEVOX_SPEAKER の既定＝ずんだもん）
    voice: VoiceSettings | None = None
    # アウトメディア視聴タイマーの上限（未設定なら2時間）
    media_timer: MediaTimerRules = MediaTimerRules()

    def daily_items(self) -> tuple[DailyItem, ...]:
        """日次3値記録の全項目（check/set が受け付ける item_key の全集合）.

        スペシャルチャレンジも summer_daily_checks に done 記録されるため含める
        （＝check/set の検証・キー一意検査の対象）。ただし base 採点は
        judge.daily_score が habits/daily/practice を明示参照するので混ざらない。
        """
        return self.habits + self.daily_homework + self.practice_homework + self.special_challenges

    def daily_item_keys(self) -> set[str]:
        return {i.key for i in self.daily_items()}

    def daily_item(self, key: str) -> DailyItem | None:
        """日次3値項目を key で引く（無ければ None）."""
        return next((i for i in self.daily_items() if i.key == key), None)

    def flag_item_keys(self) -> set[str]:
        """summer_flags 側の全 item_key（一回もの・じゅんび・選択肢のドット連結 key）."""
        keys = {i.key for i in self.one_shot_homework}
        keys.update(i.key for i in self.school_start_items)
        for group in self.choice_homework:
            keys.update(o.key for o in group.options)
        return keys

    def in_period(self, day: date) -> bool:
        return self.start <= day <= self.end

    def away_label(self, day: date) -> str | None:
        for rng in self.away:
            if rng.contains(day):
                return rng.label
        return None


def _require(data: dict, key: str, source: str) -> object:
    if key not in data or data[key] is None:
        raise SummerDefinitionError(f"{source}: 必須キー '{key}' がありません")
    return data[key]


def _as_text(value: object, label: str, source: str) -> str:
    """画面に出す文字列（名前・ラベル）として取り出す。空文字・文字列以外はエラー.

    素の str() だと `[]` が「[]」、`{}` が「{}」、`0` が「0」という項目名になって
    そのまま子どもの画面に出る。しかも validate_document は同じ値を「名前を入れて
    ください」で弾くので、インポートで入った定義が管理画面から二度と保存できなくなる
    （＝画面から直す手段がない）。表示テキストは str だけ受けて、両者の判定を揃える。
    """
    if not isinstance(value, str) or not value.strip():
        raise SummerDefinitionError(f"{source}: {label} は名前（文字列）で書いてください: {value!r}")
    return value


def _as_date(value: object, label: str, source: str) -> date:
    """日付（date か 'YYYY-MM-DD' 文字列）を date へ。それ以外はエラー."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise SummerDefinitionError(f"{source}: {label} は日付（YYYY-MM-DD）で書いてください")


# 以下3つは「壊れた定義は必ず SummerDefinitionError」を守るための入口チェック。
# 素の int() や for に渡すと ValueError / TypeError がそのまま外へ出てしまい、
# 呼び出し側が「定義が壊れている」と「サーバの障害」を区別できなくなる。


def _as_int(value: object, label: str, source: str) -> int:
    """整数へ（JSON 手書き向けに数字文字列も受ける）。bool・小数・数字でない値はエラー."""
    # bool は int のサブクラスなので先に弾く（True が 1 として通らないように）
    if not isinstance(value, bool):
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            try:
                return int(value.strip())
            except ValueError:
                pass
    raise SummerDefinitionError(f"{source}: {label} は整数で書いてください: {value!r}")


def _as_bounded_int(value: object, label: str, source: str, low: int, high: int) -> int:
    """_as_int ＋ 範囲チェック.

    範囲を持つ数は必ずこれを通す。int として読めるかだけ見て範囲を見ないと、
    「保存はできるが画面が壊れる／採点の分母が黙って変わる」値が通ってしまう。
    """
    number = _as_int(value, label, source)
    if not (low <= number <= high):
        raise SummerDefinitionError(f"{source}: {label} は {low}〜{high} の整数です: {value!r}")
    return number


def _as_entries(raw: object, label: str, source: str) -> list:
    """区画を「項目の配列」として取り出す（無ければ空）。配列でなければエラー.

    str も for で回せてしまうので、明示的に list だけ通す（でないと1文字ずつが
    項目として回り、利用者には意味の分からないエラーになる）。
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SummerDefinitionError(f"{source}: {label} は項目の配列で書いてください")
    return raw


def _as_entry(entry: object, label: str, source: str) -> dict:
    """配列の1項目をマップとして取り出す（マップでなければエラー）."""
    if not isinstance(entry, dict):
        raise SummerDefinitionError(f"{source}: {label} の項目はマップで書いてください")
    return entry


def _parse_meta_fields(raw: object, item_key: str, source: str) -> tuple[MetaField, ...]:
    fields = []
    for entry in _as_entries(raw, f"{item_key}.meta", source):
        if not isinstance(entry, dict) or "key" not in entry or "type" not in entry:
            raise SummerDefinitionError(f"{source}: {item_key} の meta 項目に key/type が必要です")
        field_type = str(entry["type"])
        if field_type not in META_TYPES:
            raise SummerDefinitionError(
                f"{source}: {item_key}.meta.type は {'/'.join(META_TYPES)} のいずれかです: {field_type}"
            )
        options: tuple[MetaOption, ...] = ()
        if field_type == META_TYPE_CHOICE:
            raw_options = _as_entries(entry.get("options"), f"{item_key}.{entry['key']}.options", source)
            if not raw_options:
                raise SummerDefinitionError(f"{source}: choice 型 '{item_key}.{entry['key']}' には options が必要です")
            options = tuple(
                MetaOption(key=str(o["key"]), label=_as_text(o["label"], f"{item_key}.options.label", source))
                for o in raw_options
                if isinstance(o, dict) and "key" in o and "label" in o
            )
            if len(options) != len(raw_options):
                raise SummerDefinitionError(f"{source}: {item_key}.{entry['key']} の options に key/label が必要です")
        fields.append(
            MetaField(
                key=str(entry["key"]),
                type=field_type,
                label=_as_text(entry.get("label", entry["key"]), f"{item_key}.meta.label", source),
                placeholder=str(entry["placeholder"]) if entry.get("placeholder") else None,
                options=options,
            )
        )
    keys = [f.key for f in fields]
    if len(keys) != len(set(keys)):
        raise SummerDefinitionError(f"{source}: {item_key} の meta フィールド key が重複しています")
    return tuple(fields)


def _parse_daily_items(raw: object, section: str, source: str) -> tuple[DailyItem, ...]:
    items = []
    for entry in _as_entries(raw, section, source):
        if not isinstance(entry, dict) or "key" not in entry or "label" not in entry:
            raise SummerDefinitionError(f"{source}: {section} の項目に key/label が必要です")
        key = str(entry["key"])
        window = entry.get("window")
        window_start: date | None = None
        window_end: date | None = None
        if window is not None:
            if window not in WINDOWS:
                raise SummerDefinitionError(
                    f"{source}: {key}.window は {'/'.join(WINDOWS)} のいずれかです: {window}"
                )
            if window == WINDOW_RANGE:
                window_start = _as_date(_require(entry, "window_start", source), f"{key}.window_start", source)
                window_end = _as_date(_require(entry, "window_end", source), f"{key}.window_end", source)
                if window_start > window_end:
                    raise SummerDefinitionError(
                        f"{source}: {key} は window_start <= window_end にしてください"
                    )
        items.append(
            DailyItem(
                key=key,
                label=_as_text(entry["label"], f"{section}.label", source),
                window=window,
                window_start=window_start,
                window_end=window_end,
                cancelable=bool(entry.get("cancelable", False)),
                meta=_parse_meta_fields(entry.get("meta"), key, source),
            )
        )
    return tuple(items)


def _parse_rewards(raw: object, source: str) -> tuple[RewardRank, ...]:
    """ご褒美ランクを検証してパース（key/label/avg 必須・avg は正の int・avg 厳密昇順・key 一意）."""
    ranks: list[RewardRank] = []
    prev_avg: int | None = None
    for entry in _as_entries(raw, "rewards", source):
        if not isinstance(entry, dict) or "key" not in entry or "label" not in entry or "avg" not in entry:
            raise SummerDefinitionError(f"{source}: rewards の項目に key/label/avg が必要です")
        avg = entry["avg"]
        # bool は int のサブクラスなので明示除外（True/False を平均点に使わせない）
        if not isinstance(avg, int) or isinstance(avg, bool) or avg <= 0:
            raise SummerDefinitionError(f"{source}: rewards '{entry['key']}' の avg は 1 以上の整数です")
        if prev_avg is not None and avg <= prev_avg:
            raise SummerDefinitionError(f"{source}: rewards は avg の昇順（小さい→大きい）で並べてください")
        prev_avg = avg
        prize = entry.get("prize")
        ranks.append(
            RewardRank(
                key=str(entry["key"]),
                label=_as_text(entry["label"], "rewards.label", source),
                avg=int(avg),
                prize=str(prize) if prize is not None else None,
            )
        )
    keys = [r.key for r in ranks]
    if len(keys) != len(set(keys)):
        raise SummerDefinitionError(f"{source}: rewards の key が重複しています")
    return tuple(ranks)


def _parse_voice(raw: object, source: str) -> VoiceSettings | None:
    """読み上げの声を検証してパース（区画ごと省略可＝既定の話者を使う）."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise SummerDefinitionError(f"{source}: voice はオブジェクトです")
    speaker = raw.get("speaker")
    # bool は int のサブクラスなので明示除外（True が話者ID 1 として通らないように）
    if not isinstance(speaker, int) or isinstance(speaker, bool) or speaker < 0:
        raise SummerDefinitionError(f"{source}: voice.speaker は 0 以上の整数（VOICEVOX の話者ID）です")
    label = raw.get("label")
    return VoiceSettings(speaker=speaker, label=str(label) if label else None)


def _parse_media_timer(raw: object, source: str) -> MediaTimerRules:
    """視聴タイマーの上限を検証してパース（区画ごと省略可＝既定2時間）."""
    if raw is None:
        return MediaTimerRules()
    if not isinstance(raw, dict):
        raise SummerDefinitionError(f"{source}: media_timer はオブジェクトです")
    minutes = raw.get("limit_minutes", MEDIA_LIMIT_MINUTES_DEFAULT)
    # bool は int のサブクラスなので明示除外（True が「1分」として通らないように）
    if (
        not isinstance(minutes, int)
        or isinstance(minutes, bool)
        or not (1 <= minutes <= MEDIA_LIMIT_MINUTES_MAX)
    ):
        raise SummerDefinitionError(
            f"{source}: media_timer.limit_minutes は 1〜{MEDIA_LIMIT_MINUTES_MAX} の整数（分）です"
        )
    return MediaTimerRules(limit_minutes=int(minutes))


def format_meta_value(field: MetaField, value: object) -> str:
    """メモ1フィールドの値を人が読める短文に整形する（表示・読み上げで共用・純関数）."""
    if field.type == META_TYPE_CHOICE:
        label = next((o.label for o in field.options if o.key == value), str(value))
        return f"{field.label}は{label}"
    if field.type == META_TYPE_DURATION:
        try:
            secs = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return f"{field.label}は{value}"
        minutes, seconds = divmod(max(secs, 0), 60)
        span = f"{minutes}分{seconds}秒" if minutes else f"{seconds}秒"
        return f"{field.label}は{span}"
    return f"{field.label}は{value}"


def parse_grade(value: object, source: str) -> tuple[str, int]:
    """学年表記（小1〜小6）を検証して (表示文字列, 数値) を返す."""
    grade = str(value or "")
    # fullmatch: re の $ は末尾改行の手前にも当たるため、match だと "小3\n" が通ってしまう
    # （そのまま表示用の grade として保存され、画面に改行つきで出る）
    m = _GRADE_RE.fullmatch(grade)
    if not m:
        raise SummerDefinitionError(f"{source}: grade は 小1〜小6 のいずれかで書いてください: {grade!r}")
    return grade, int(m.group(1))


def parse_definition(doc: dict, source: str = "定義") -> SummerDefinition:
    """定義ドキュメント（dict）を検証して SummerDefinition を返す。壊れていれば SummerDefinitionError.

    どんな doc を渡されても、投げるのは SummerDefinitionError だけ（呼び出し側が
    「定義が壊れている」と「サーバの障害」を区別できるようにするための契約）。
    そのために型は _as_int / _as_entries / _as_entry で入口チェックしてから使う。
    ここを try/except で包んで例外を SummerDefinitionError に変換するのは間違い：
    パーサ自身のバグまで「あなたの定義が壊れています」と報告してしまい、
    利用者は壊れていない定義を直しに行くことになる（バグは 500 として出すべき）。
    契約は tests/test_summer_definition.py の敵対的入力テストが恒常検査する。
    """
    if not isinstance(doc, dict):
        raise SummerDefinitionError(f"{source}: トップレベルがマップではありません")

    period = _require(doc, "period", source)
    if not isinstance(period, dict):
        raise SummerDefinitionError(f"{source}: period はマップで書いてください")
    start = _as_date(_require(period, "start", source), "period.start", source)
    end = _as_date(_require(period, "end", source), "period.end", source)
    first_day = _as_date(_require(period, "first_day_of_school", source), "period.first_day_of_school", source)
    if not (start < end < first_day):
        raise SummerDefinitionError(f"{source}: period は start < end < first_day_of_school の順にしてください")

    away = tuple(
        AwayRange(
            start=_as_date(_require(e, "start", source), "away.start", source),
            end=_as_date(_require(e, "end", source), "away.end", source),
            label=_as_text(_require(e, "label", source), "away.label", source),
        )
        for e in (
            _as_entry(entry, "away", source)
            for entry in _as_entries(doc.get("away"), "away", source)
        )
    )

    # card_rules は既定値（はじめ／おわり5日）を持つので、区画ごと無くても読める。
    # ただし「無い」と「壊れている」は分ける: `or {}` で畳むと [] や 0 や "" が黙って
    # 既定値になり、parse は通るのに validate_document は弾く定義ができてしまう
    # （＝インポートはできるのに管理画面から二度と保存できない子）。
    card_raw = doc.get("card_rules")
    if card_raw is None:
        card_raw = {}
    if not isinstance(card_raw, dict):
        raise SummerDefinitionError(f"{source}: card_rules はオブジェクトです")
    card_rules = CardRules(
        edges_window_days=_as_bounded_int(
            card_raw.get("edges_window_days", EDGES_WINDOW_DAYS_DEFAULT),
            "card_rules.edges_window_days",
            source,
            1,
            EDGES_WINDOW_DAYS_MAX,
        )
    )

    habits = _parse_daily_items(doc.get("habits"), "habits", source)
    daily_homework = _parse_daily_items(doc.get("daily_homework"), "daily_homework", source)
    practice_homework = _parse_daily_items(doc.get("practice_homework"), "practice_homework", source)
    special_challenges = _parse_daily_items(doc.get("special_challenges"), "special_challenges", source)
    rewards = _parse_rewards(doc.get("rewards"), source)

    one_shot = []
    for entry in _as_entries(doc.get("one_shot_homework"), "one_shot_homework", source):
        if not isinstance(entry, dict) or "key" not in entry or "label" not in entry:
            raise SummerDefinitionError(f"{source}: one_shot_homework の項目に key/label が必要です")
        item_type = str(entry.get("type", "flag"))
        if item_type not in ("flag", "count"):
            raise SummerDefinitionError(f"{source}: one_shot_homework.type は flag か count です: {entry['key']}")
        target = entry.get("target")
        if item_type == "count" and (not isinstance(target, int) or isinstance(target, bool) or target < 1):
            raise SummerDefinitionError(f"{source}: count 型 '{entry['key']}' には target（1以上の整数）が必要です")
        one_shot.append(
            OneShotItem(
                key=str(entry["key"]),
                label=_as_text(entry["label"], "one_shot_homework.label", source),
                required=bool(entry.get("required", True)),
                type=item_type,
                target=int(target) if item_type == "count" else None,
            )
        )

    choice_groups = []
    for entry in _as_entries(doc.get("choice_homework"), "choice_homework", source):
        if not isinstance(entry, dict) or "key" not in entry or "options" not in entry:
            raise SummerDefinitionError(f"{source}: choice_homework の項目に key/options が必要です")
        group_key = str(entry["key"])
        options = tuple(
            ChoiceOption(
                key=f"{group_key}.{_require(o, 'key', source)}",
                label=_as_text(_require(o, "label", source), f"{group_key}.options.label", source),
                category=o.get("category"),
            )
            for o in (
                _as_entry(raw_option, f"{group_key}.options", source)
                for raw_option in _as_entries(entry["options"], f"{group_key}.options", source)
            )
        )
        min_required = _as_int(entry.get("min_required", 1), f"{group_key}.min_required", source)
        if not (1 <= min_required <= len(options)):
            raise SummerDefinitionError(
                f"{source}: choice_homework '{group_key}' の min_required が選択肢数と矛盾しています"
            )
        choice_groups.append(
            ChoiceGroup(
                key=group_key,
                label=_as_text(_require(entry, "label", source), f"{group_key}.label", source),
                min_required=min_required,
                options=options,
            )
        )

    school_start = tuple(
        SchoolStartItem(
            key=str(_require(e, "key", source)),
            label=_as_text(_require(e, "label", source), "school_start_items.label", source),
            due=_as_date(_require(e, "due", source), "school_start_items.due", source),
        )
        for e in (
            _as_entry(entry, "school_start_items", source)
            for entry in _as_entries(doc.get("school_start_items"), "school_start_items", source)
        )
    )

    child_name = _as_text(_require(doc, "child", source), "child", source)
    grade, grade_level = parse_grade(_require(doc, "grade", source), source)
    definition = SummerDefinition(
        child=child_name,
        child_kana=str(doc.get("child_kana") or child_name),
        year=_as_int(_require(doc, "year", source), "year", source),
        grade=grade,
        grade_level=grade_level,
        start=start,
        end=end,
        first_day_of_school=first_day,
        away=away,
        card_rules=card_rules,
        habits=habits,
        daily_homework=daily_homework,
        practice_homework=practice_homework,
        one_shot_homework=tuple(one_shot),
        choice_homework=tuple(choice_groups),
        school_start_items=school_start,
        special_challenges=special_challenges,
        rewards=rewards,
        voice=_parse_voice(doc.get("voice"), source),
        media_timer=_parse_media_timer(doc.get("media_timer"), source),
    )

    # key の一意性（DB 記録キーの衝突防止）。日次系と flags 系はテーブルが別なので別空間で検査
    daily_keys = [i.key for i in definition.daily_items()]
    if len(daily_keys) != len(set(daily_keys)):
        raise SummerDefinitionError(f"{source}: habits/daily/practice/challenges の key が重複しています")
    flag_keys = [i.key for i in definition.one_shot_homework] + [i.key for i in definition.school_start_items]
    for group in definition.choice_homework:
        flag_keys.extend(o.key for o in group.options)
    if len(flag_keys) != len(set(flag_keys)):
        raise SummerDefinitionError(f"{source}: one_shot/school_start/choice の key が重複しています")

    return definition


# ---- DB からの読み取り（保存・履歴・改名は app/admin/definition_store.py） ----


def period_bounds(doc: object) -> tuple[str, str] | None:
    """doc から期間 ('YYYY-MM-DD', 'YYYY-MM-DD') を素朴に取り出す（読めなければ None）.

    使い道は「どの年の定義を出すか」の選択だけ。ここでは検証しない（壊れていれば None）。
    壊れた年を候補から外して黙って別の年を出す、という隠蔽はしない：期間が読めない年も
    select_definition_year の最後の枝で選ばれうるので、他に出せる年が無ければ 503 になる
    ＝親が直すべき定義が画面から消えない。
    """
    if not isinstance(doc, dict):
        return None
    period = doc.get("period")
    if not isinstance(period, dict):
        return None
    start, end = period.get("start"), period.get("end")
    if isinstance(start, str) and isinstance(end, str) and start <= end:
        return (start, end)
    return None


def select_definition_year(
    candidates: Sequence[tuple[int, tuple[str, str] | None]], today: date
) -> int:
    """複数年の定義から「いま画面に出す年」を1つ選ぶ（純粋関数）.

    優先順:
      1. 今日を含む期間の年 — 夏休みの最中はその年で確定。**来年ぶんを夏の最中に
         作っても画面は今年のまま**（ここが年またぎでいちばん壊したくない性質）
      2. 直近に終わった夏（end < 今日 のうち end が最大）— 9月以降も今年の記録を見返せる
      3. これから来る夏（start > 今日 のうち start が最小）— 初回登録を早めにした直後
      4. 期間が読めない年（壊れた定義）— 他に候補が無いときだけ。年の大きいほう
    同点は年の大きいほうを採る（どの端末で見ても同じ年になるよう決定的にする）。
    """
    iso = today.isoformat()
    dated = [(year, bounds) for year, bounds in candidates if bounds is not None]
    current = [year for year, bounds in dated if bounds[0] <= iso <= bounds[1]]
    if current:
        return max(current)
    past = [(year, bounds) for year, bounds in dated if bounds[1] < iso]
    if past:
        return max(past, key=lambda e: (e[1][1], e[0]))[0]
    future = [(year, bounds) for year, bounds in dated if bounds[0] > iso]
    if future:
        return min(future, key=lambda e: (e[1][0], -e[0]))[0]
    return max(year for year, _ in candidates)


def _definition_rows(child: str, db_path: Path | None) -> list[tuple[int, str]]:
    with app_db.connect(db_path) as conn:
        return [
            (int(year), doc_text)
            for year, doc_text in conn.execute(
                "SELECT year, doc FROM summer_definitions WHERE child = ? ORDER BY year",
                (child,),
            ).fetchall()
        ]


def _pick_row(rows: Sequence[tuple[int, str]], today: date | None) -> tuple[int, str]:
    """(year, doc_text) の並びから、いま出す年の1件を選ぶ."""
    if len(rows) == 1:
        return rows[0]
    if today is None:
        today = datetime.now(JST).date()
    candidates: list[tuple[int, tuple[str, str] | None]] = []
    for year, doc_text in rows:
        try:
            candidates.append((year, period_bounds(json.loads(doc_text))))
        except json.JSONDecodeError:
            candidates.append((year, None))
    year = select_definition_year(candidates, today)
    return next(row for row in rows if row[0] == year)


def load_definition(
    child: str, db_path: Path | None = None, today: date | None = None
) -> SummerDefinition:
    """その子の「いま出す年」の定義を DB から読み込み・検証して返す（無ければ SummerDefinitionError）.

    年が1つしか無ければそれ（＝年またぎを使わない家庭では従来と同じ）。複数年あるときの
    選び方は select_definition_year を参照。today は呼び出し側（service）から渡す
    ＝「今日」の決め方をアプリ内で1か所に保つ（テストの固定も1か所で効く）。
    """
    rows = _definition_rows(child, db_path)
    if not rows:
        raise SummerDefinitionError(f"定義が見つかりません: {child}")
    year, doc_text = _pick_row(rows, today)
    try:
        doc = json.loads(doc_text)
    except json.JSONDecodeError as e:
        raise SummerDefinitionError(f"{child} の定義 JSON が壊れています: {e}") from e
    return parse_definition(doc, source=f"{child}（{year}年）")


def list_definition_years(child: str, db_path: Path | None = None) -> list[int]:
    """その子に登録されている年の一覧（昇順）。管理画面の年タブ用."""
    return [year for year, _ in _definition_rows(child, db_path)]


def display_year(child: str, db_path: Path | None = None, today: date | None = None) -> int | None:
    """いま子ども画面に出ている年（未登録なら None）.

    管理画面が「年の指定なし」で編集・保存するときの既定年でもある
    ＝親は画面で見えているものを直しに来るので、読みと同じ年を開く。
    """
    rows = _definition_rows(child, db_path)
    if not rows:
        return None
    return _pick_row(rows, today)[0]


def list_children(db_path: Path | None = None, today: date | None = None) -> list[dict]:
    """全定義の一覧（子どもごとに「いま出す年」の1件）。壊れた定義もエラー内容つきで含める.

    フロントの子ども選択（/api/summer/children）と管理画面の一覧が共用する。
    years には登録されている年を全部入れる（管理画面が年タブを出すため）。
    """
    with app_db.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT child, year, doc, revision, updated_at FROM summer_definitions "
            "ORDER BY child, year"
        ).fetchall()
    by_child: dict[str, list[tuple]] = {}
    for row in rows:
        by_child.setdefault(row[0], []).append(row)
    result = []
    for child, child_rows in by_child.items():
        years = [int(r[1]) for r in child_rows]
        picked_year, _ = _pick_row([(int(r[1]), r[2]) for r in child_rows], today)
        _, year, doc_text, revision, updated_at = next(
            r for r in child_rows if int(r[1]) == picked_year
        )
        entry: dict = {
            "child": child,
            "year": year,
            "years": years,
            "revision": revision,
            "updated_at": updated_at,
        }
        try:
            definition = parse_definition(json.loads(doc_text), source=f"{child}（{year}年）")
            entry.update(
                {
                    "valid": True,
                    "error": None,
                    "child_kana": definition.child_kana,
                    "grade": definition.grade,
                    "period": {
                        "start": definition.start.isoformat(),
                        "end": definition.end.isoformat(),
                        "first_day_of_school": definition.first_day_of_school.isoformat(),
                    },
                }
            )
        except (SummerDefinitionError, json.JSONDecodeError) as e:
            entry.update({"valid": False, "error": str(e), "child_kana": child, "grade": None, "period": None})
        result.append(entry)
    return result

"""バックエンドのロジックの「入力と出力」を金型として書き出す。

lite 版は同じ計算を TypeScript で持つ。ロジックはデータと違って機械で写せないので、
移植したうえで**バックエンドが実際に出した答え**と突き合わせる。ここはその答えを作る。

  cd backend && uv run python tools/dump_golden.py

出力は frontend/src/lib/core/__golden__/*.json。TS 側の *.golden.test.ts が
input を食わせて output と比べる。CI は再生成して git diff --exit-code する
（Python を直して TS を忘れる、を落とすため）。

入力も一緒に固めるのが要点。出力だけ置くと「何を入れたときの答えか」が失われ、
TS 側は同じ状況を作り直せない。
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.summer import judge, kanji, praise, speech, ui_text  # noqa: E402
from app.summer.definition import (  # noqa: E402
    SummerDefinitionError,
    parse_definition,
    period_bounds,
    select_definition_year,
)
# _doc_paths / _HOSTILE_VALUES / _DELETE を直接使うのは、敵対的スイープの中身を
# tools 側で作り直さないため（作り直すとテストと静かにずれる）。
from tests.conftest import (  # noqa: E402
    _DELETE,
    _HOSTILE_VALUES,
    _doc_paths,
    load_sample_doc,
)

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "core" / "__golden__"

NOTE = (
    "自動生成。手で編集しないこと。"
    " 作り直す: cd backend && uv run python tools/dump_golden.py"
)


def hostile_mutations(base: dict):
    """サンプル定義の各パスを壊す「操作」を (説明, 操作, 壊した doc) で返す。

    金型に doc 全体を焼き込むと、1件あたり数KB×2,000件超で数十MBになる。操作だけ
    書き出して、TS 側が同じ操作をサンプル定義に当てて組み立てる。
    """
    for path in list(_doc_paths(base)):
        for value in (*_HOSTILE_VALUES, _DELETE):
            doc = json.loads(json.dumps(base))
            parent = doc
            for step in path[:-1]:
                parent = parent[step]
            if value is _DELETE:
                del parent[path[-1]]
                mutation = {"path": list(path), "op": "delete"}
                shown = "削除"
            else:
                parent[path[-1]] = value
                mutation = {"path": list(path), "op": "set", "value": value}
                shown = repr(value)
            yield f"/{'/'.join(map(str, path))} = {shown}", mutation, doc


def write(name: str, cases: list[dict], about: str) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"_note": NOTE, "about": about, "cases": cases}
    (OUT_DIR / name).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{name}: {len(cases)} 件")


# ---- 漢字 ----


def dump_kanji() -> None:
    cases = [
        {
            "name": "字数の錠",
            "input": {"kind": "counts"},
            "output": [len(kanji.GRADE_KANJI[g]) for g in range(1, 7)],
        }
    ]
    samples = [
        "新学期《しんがっき》のじゅんび",
        "音読《おんどく》カード",
        "今日《きょう》は 100点《てん》だよ。",
        "時々《ときどき》お手伝《てつだ》いをする",
        "夏休《なつやす》みのおわり",
        "計算《けいさん》カード",
        "早寝《はやね》早起《はやお》き朝《あさ》ごはん",
        "読書《どくしょ》の記録《きろく》",
        "自由《じゆう》研究《けんきゅう》",
        "絵日記《えにっき》",
    ]
    for text in samples:
        for grade in range(1, 7):
            cases.append(
                {
                    "name": f"openForGrade({text!r}, {grade})",
                    "input": {"kind": "open", "text": text, "grade": grade},
                    "output": kanji.open_for_grade(text, grade),
                }
            )
    for text in samples:
        cases.append(
            {
                "name": f"validateRubySource({text!r})",
                "input": {"kind": "validate", "text": text},
                "output": kanji.validate_ruby_source(text),
            }
        )
    for bad in ["お｜手《て》つだい", "こわれた《", "音読《おんどく", "漢字がむき出し", "空《》"]:
        cases.append(
            {
                "name": f"validateRubySource({bad!r})",
                "input": {"kind": "validate", "text": bad},
                "output": kanji.validate_ruby_source(bad),
            }
        )
    write("kanji.json", cases, "openForGrade / validateRubySource / 配当の字数")


# ---- 画面の固定文言 ----


def dump_ui_text() -> None:
    cases = [
        {
            "name": f"buildUiText(grade={g})",
            "input": {"kind": "uiText", "grade": g},
            "output": ui_text.ui_text_for(g),
        }
        for g in range(1, 7)
    ]
    # 「分」の音便（ぷん／ふん）。プリセットの 30分・90分がそのまま該当する。
    for minutes in [1, 2, 3, 4, 5, 6, 8, 9, 10, 20, 30, 45, 60, 61, 90, 120, 125, 1440]:
        for grade in (1, 6):
            cases.append(
                {
                    "name": f"mediaLimitLabel({minutes}, {grade})",
                    "input": {"kind": "mediaLimit", "minutes": minutes, "grade": grade},
                    "output": ui_text.media_limit_label(minutes, grade),
                }
            )
    # {limit} の差し替え経路
    for grade in (1, 3, 6):
        cases.append(
            {
                "name": f"buildUiText(grade={grade}, limit=90)",
                "input": {"kind": "uiText", "grade": grade, "mediaLimitMinutes": 90},
                "output": ui_text.ui_text_for(grade, 90),
            }
        )
    # {score_max} の差し替え経路（1日の最大点＝100＋項目数×25。標準テンプレの2項目は150）
    for grade, score_max in ((1, 150), (6, 200)):
        cases.append(
            {
                "name": f"buildUiText(grade={grade}, scoreMax={score_max})",
                "input": {"kind": "uiText", "grade": grade, "scoreMax": score_max},
                "output": ui_text.ui_text_for(grade, score_max=score_max),
            }
        )
    write("uiText.json", cases, "固定文言の学年別展開と、視聴上限の表記")


# ---- 褒めメッセージ ----


def _score(base: int, bonus: int) -> judge.ScoreBreakdown:
    """帯の判定に必要なぶんだけ組んだ採点結果（parts は使わない）."""
    return judge.ScoreBreakdown(score=base, parts=(), bonus=bonus, total=base + bonus)


def dump_praise() -> None:
    cases = []
    scores = [(100, 25), (100, 0), (90, 0), (80, 0), (60, 0), (50, 0), (30, 0), (0, 0)]
    days = ["2026-07-21", "2026-08-01", "2026-08-15", "2026-08-31", "2026-09-01"]
    for child in ["はな", "そら", "ゆうと"]:
        for grade in range(1, 7):
            for base, bonus in scores:
                for has_records in (True, False):
                    for away in (None, "おばあちゃんの家"):
                        day = days[(base + grade) % len(days)]
                        cases.append(
                            {
                                "name": f"{child}/{grade}/{base}+{bonus}/{has_records}/{bool(away)}",
                                "input": {
                                    "child": child,
                                    "day": day,
                                    "score": {"score": base, "bonus": bonus, "total": base + bonus},
                                    "hasRecords": has_records,
                                    "gradeLevel": grade,
                                    "awayLabel": away,
                                },
                                "output": praise.build_praise(
                                    child,
                                    date.fromisoformat(day),
                                    _score(base, bonus),
                                    has_records,
                                    _AwayStub(grade, away),
                                ),
                            }
                        )
    # 同じ子・同じ日なら同じ文、日が変われば回る、を固定する
    for day in days:
        cases.append(
            {
                "name": f"バリアント選択 {day}",
                "input": {
                    "child": "はな",
                    "day": day,
                    "score": {"score": 100, "bonus": 0, "total": 100},
                    "hasRecords": True,
                    "gradeLevel": 2,
                    "awayLabel": None,
                },
                "output": praise.build_praise(
                    "はな", date.fromisoformat(day), _score(100, 0), True, _AwayStub(2, None)
                ),
            }
        )
    write("praise.json", cases, "スコア帯×学年帯×おでかけの褒め文（crc32 のバリアント選択込み）")


class _AwayStub:
    """build_praise が定義から見るのは grade_level と away_label() だけ."""

    def __init__(self, grade_level: int, away: str | None) -> None:
        self.grade_level = grade_level
        self._away = away

    def away_label(self, day: date) -> str | None:  # noqa: ARG002
        return self._away


# ---- 読み上げ文 ----


def dump_speech() -> None:
    definition = parse_definition(load_sample_doc())
    day = date(2026, 8, 1)
    remaining = judge.remaining_today(day, {}, {}, {}, definition)
    scenarios = {
        "残りあり": remaining,
        "全部おわり": (),
        "6件（上限超え）": tuple(
            judge.RemainingItem(kind="habit", key=f"h{i}", label=f"こうもく{i}") for i in range(6)
        ),
        "じゅんびだけ": (
            judge.RemainingItem(
                kind="school_start", key="ss", label="ぼうしをもっていく", note="9/1まで"
            ),
        ),
    }
    cases = []
    for name, items in scenarios.items():
        for grade in (1, 4, 6):
            for in_period in (True, False):
                for away in (None, "りょこう"):
                    stub = _SpeechStub(definition.child_kana, grade, in_period, away)
                    cases.append(
                        {
                            "name": f"{name}/{grade}/{in_period}/{bool(away)}",
                            "input": {
                                "items": [
                                    {
                                        "kind": i.kind,
                                        "key": i.key,
                                        "label": i.label,
                                        "note": i.note,
                                    }
                                    for i in items
                                ],
                                "childKana": definition.child_kana,
                                "gradeLevel": grade,
                                "inPeriod": in_period,
                                "awayLabel": away,
                            },
                            "output": speech.todo_speech_text(day, items, stub),
                        }
                    )
    write("speech.json", cases, "「きょうやること」読み上げ文の組み立て")


class _SpeechStub:
    """todo_speech_text が定義から見るのは4つだけ."""

    def __init__(self, kana: str, grade: int, in_period: bool, away: str | None) -> None:
        self.child_kana = kana
        self.grade_level = grade
        self._in_period = in_period
        self._away = away

    def in_period(self, day: date) -> bool:  # noqa: ARG002
        return self._in_period

    def away_label(self, day: date) -> str | None:  # noqa: ARG002
        return self._away


# ---- 定義パース（敵対的入力スイープ） ----


def dump_definition() -> None:
    base = load_sample_doc()
    cases = [
        {
            "name": "サンプル定義（正常）",
            "input": {"mutation": None},
            "output": {"accepted": True},
        }
    ]
    for label, mutation, doc in hostile_mutations(base):
        try:
            parse_definition(doc)
            accepted = True
        except SummerDefinitionError:
            accepted = False
        cases.append(
            {"name": label, "input": {"mutation": mutation}, "output": {"accepted": accepted}}
        )
    write(
        "definition.json",
        cases,
        "サンプル定義の全パスを壊したときに受理するか（メッセージ文言は比べない）",
    )


# ---- 何年ぶんを出すか ----


def dump_select_year() -> None:
    sets = {
        "2年ぶん": [(2026, ("2026-07-21", "2026-08-31")), (2027, ("2027-07-20", "2027-08-30"))],
        "期間が読めない年つき": [(2026, ("2026-07-21", "2026-08-31")), (2027, None)],
        "全部読めない": [(2026, None), (2027, None)],
        "1年だけ": [(2026, ("2026-07-21", "2026-08-31"))],
        "終わりが同じ": [(2026, ("2026-07-21", "2026-08-31")), (2025, ("2025-07-21", "2026-08-31"))],
    }
    days = ["2026-07-01", "2026-08-01", "2026-09-01", "2027-08-01", "2028-01-01"]
    cases = []
    for name, candidates in sets.items():
        for day in days:
            cases.append(
                {
                    "name": f"{name} / {day}",
                    "input": {"candidates": candidates, "today": day},
                    "output": select_definition_year(candidates, date.fromisoformat(day)),
                }
            )
    # period_bounds そのもの
    for doc in [
        load_sample_doc(),
        {"period": {"start": "2026-07-21", "end": "2026-08-31"}},
        {"period": {"start": "2026-09-01", "end": "2026-08-31"}},
        {"period": {"start": 1, "end": "2026-08-31"}},
        {"period": "こわれている"},
        {},
        [],
        "もじ",
    ]:
        cases.append(
            {
                "name": f"periodBounds({json.dumps(doc, ensure_ascii=False)[:40]})",
                "input": {"kind": "periodBounds", "doc": doc},
                "output": list(period_bounds(doc)) if period_bounds(doc) else None,
            }
        )
    write("selectYear.json", cases, "複数年から「いま出す年」を選ぶ規則")


# ---- 採点 ----


def dump_judge() -> None:
    definition = parse_definition(load_sample_doc())
    doc = load_sample_doc()
    habits = [h["key"] for h in doc.get("habits", [])]
    dailies = [h["key"] for h in doc.get("daily_homework", [])]
    challenges = [h["key"] for h in doc.get("special_challenges", [])]

    def statuses(n_habit: int, n_daily: int, n_challenge: int = 0) -> dict:
        s = {}
        for k in habits[:n_habit]:
            s[k] = "done"
        for k in dailies[:n_daily]:
            s[k] = "done"
        for k in challenges[:n_challenge]:
            s[k] = "done"
        return s

    cases = []
    # 丸めの境目をひととおり（int(v+0.5) と偶数丸めの差はここにしか出ない）
    combos = [
        (0, 0, 0),
        (1, 0, 0),
        (2, 0, 0),
        (3, 0, 0),
        (0, 1, 0),
        (0, 2, 0),
        (0, 3, 0),
        (0, 4, 0),
        (0, 5, 0),
        (len(habits), len(dailies), 0),
        (len(habits), len(dailies), 1),
        (len(habits), len(dailies), len(challenges)),
        (len(habits) - 1, len(dailies), 1),
        (len(habits), len(dailies) - 1, 1),
        (1, 1, 1),
    ]
    days = ["2026-07-21", "2026-07-25", "2026-07-26", "2026-08-27", "2026-08-31", "2026-08-15"]
    for day in days:
        for combo in combos:
            s = statuses(*combo)
            cases.append(
                {
                    "name": f"dailyScore {day} {combo}",
                    "input": {"kind": "dailyScore", "statuses": s, "day": day},
                    "output": _score_to_dict(
                        judge.daily_score(s, date.fromisoformat(day), definition)
                    ),
                }
            )
    # 中止（雨天）は満点扱い
    cancelable = [h["key"] for h in doc.get("habits", []) if h.get("cancelable")]
    if cancelable:
        s = statuses(len(habits), len(dailies))
        s[cancelable[0]] = "cancelled"
        cases.append(
            {
                "name": "中止は満点扱い",
                "input": {"kind": "dailyScore", "statuses": s, "day": "2026-08-01"},
                "output": _score_to_dict(judge.daily_score(s, date(2026, 8, 1), definition)),
            }
        )

    # edges 窓の境目
    for day in ["2026-07-21", "2026-07-25", "2026-07-26", "2026-08-26", "2026-08-27", "2026-08-31"]:
        cases.append(
            {
                "name": f"habitsDue {day}",
                "input": {"kind": "habitsDue", "day": day},
                "output": [h.key for h in judge.habits_due(date.fromisoformat(day), definition)],
            }
        )

    # ストリーク（おでかけと今日は透明）
    streaks = [
        [[100, False, False], [100, False, False], [80, False, False], [100, False, True]],
        [[100, False, False], [None, True, False], [100, False, False], [None, False, True]],
        [[None, False, False], [100, False, False]],
        [],
        [[100, True, False], [100, False, False]],
    ]
    for i, days_seq in enumerate(streaks):
        cases.append(
            {
                "name": f"perfectStreaks #{i}",
                "input": {"kind": "perfectStreaks", "days": days_seq},
                "output": _streak_to_dict(
                    judge.perfect_streaks([tuple(d) for d in days_seq])
                ),
            }
        )

    # ごほうびランクの進捗（ペースの分母は今日を除く）
    ranks = definition.rewards
    totals_sets = [
        [100, 100, 100, None, None],
        [100, None, 50, None, None],
        [None, None, None, None, None],
        [125, 125, 125, 125, 125],
        [0, 0, 0, 0, 0],
    ]
    for i, totals in enumerate(totals_sets):
        for recorded, completed in [(0, 0), (1, 0), (3, 2), (5, 4), (5, 5)]:
            cases.append(
                {
                    "name": f"rewardProgress #{i} {recorded}/{completed}",
                    "input": {
                        "kind": "rewardProgress",
                        "dayTotals": totals,
                        "daysRecordedUntil": recorded,
                        "daysCompleted": completed,
                        "daysTotal": len(totals),
                    },
                    "output": _reward_to_dict(
                        judge.reward_progress(totals, recorded, completed, len(totals), ranks)
                    ),
                }
            )

    # 「きょうやること」の残り（リード日数の境目を含む）
    end = definition.end
    for offset in [0, 5, 6, 7, 8, 20]:
        day = end - timedelta(days=offset)
        cases.append(
            {
                "name": f"remainingToday 終了{offset}日前",
                "input": {
                    "kind": "remainingToday",
                    "day": day.isoformat(),
                    "statuses": {},
                    "flagValues": {},
                    "decisions": {},
                },
                "output": [
                    {"kind": i.kind, "key": i.key, "label": i.label, "note": i.note}
                    for i in judge.remaining_today(day, {}, {}, {}, definition)
                ],
            }
        )
    for prep in definition.school_start_items[:1]:
        for offset in [2, 3, 4]:
            day = prep.due - timedelta(days=offset)
            cases.append(
                {
                    "name": f"remainingToday じゅんび{offset}日前",
                    "input": {
                        "kind": "remainingToday",
                        "day": day.isoformat(),
                        "statuses": {},
                        "flagValues": {},
                        "decisions": {},
                    },
                    "output": [
                        {"kind": i.kind, "key": i.key, "label": i.label, "note": i.note}
                        for i in judge.remaining_today(day, {}, {}, {}, definition)
                    ],
                }
            )

    # えらぶ宿題の必要数（min_required）の境目。サンプル定義は min_required=1 なので、
    # そのままでは「1つ終えた＝必要数を満たした」と区別がつかず、件数で見ているかを
    # 検査できない。定義を差し替えた1件として金型に入れる（doc 全体ではなく操作だけ）。
    for min_required in (2, 3):
        mutated_doc = load_sample_doc()
        mutated_doc["choice_homework"][0]["min_required"] = min_required
        mutated = parse_definition(mutated_doc)
        mutation = {
            "path": ["choice_homework", 0, "min_required"],
            "op": "set",
            "value": min_required,
        }
        group = mutated.choice_homework[0]
        day = mutated.end
        for done in range(min_required + 2):
            flag_values = {o.key: 1 for o in group.options[:done]}
            cases.append(
                {
                    "name": f"remainingToday えらぶ宿題 必要{min_required}個 済み{done}個",
                    "input": {
                        "kind": "remainingToday",
                        "day": day.isoformat(),
                        "statuses": {},
                        "flagValues": flag_values,
                        "decisions": {},
                        "mutation": mutation,
                    },
                    "output": [
                        {"kind": i.kind, "key": i.key, "label": i.label, "note": i.note}
                        for i in judge.remaining_today(day, {}, flag_values, {}, mutated)
                    ],
                }
            )

    # 「全部やらない」を作らせない判定
    for group in definition.choice_homework:
        opts = [o.key for o in group.options]
        for decisions in [{}, {opts[0]: "skip"}, {k: "skip" for k in opts[:-1]}]:
            for target in opts:
                cases.append(
                    {
                        "name": f"canSkip {group.key} {target} {sorted(decisions)}",
                        "input": {
                            "kind": "canSkip",
                            "groupKey": group.key,
                            "decisions": decisions,
                            "optionKey": target,
                        },
                        "output": judge.can_skip(group, decisions, target),
                    }
                )

    write("judge.json", cases, "採点・窓・ストリーク・ごほうび進捗・残り列挙")


def _score_to_dict(s: judge.ScoreBreakdown) -> dict:
    return {
        "score": s.score,
        "parts": [
            {
                "name": p.name,
                "label": p.label,
                "points": p.points,
                "max_points": p.max_points,
                "done": p.done,
                "total": p.total,
            }
            for p in s.parts
        ],
        "bonus": s.bonus,
        "total": s.total,
        "challenges": [{"key": c.key, "label": c.label, "done": c.done} for c in s.challenges],
        "challenge_max": s.challenge_max,
        "unlocked": s.unlocked,
        "bonus_pending": s.bonus_pending,
    }


def _streak_to_dict(s: judge.StreakInfo) -> dict:
    return {
        "perfect_current": s.perfect_current,
        "perfect_best": s.perfect_best,
        "perfect_total": s.perfect_total,
    }


def _reward_to_dict(r: judge.RewardProgress) -> dict:
    return {
        "total": r.total,
        "cumulative": list(r.cumulative),
        "ranks": [
            {
                "key": x.key,
                "label": x.label,
                "avg": x.avg,
                "threshold": x.threshold,
                "prize": x.prize,
                "achieved": x.achieved,
            }
            for x in r.ranks
        ],
        "achieved_key": r.achieved_key,
        "pace_key": r.pace_key,
        "projected_total": r.projected_total,
    }


def dump_sample() -> None:
    """サンプル定義そのもの。TS 側のテストが同じ定義でロジックを回すために要る
    （docs/examples/ を frontend から直接 import すると src の外に出てしまう）."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "sampleDoc.json").write_text(
        json.dumps(load_sample_doc(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("sampleDoc.json: docs/examples/2026-はな.json の写し")


def dump_validate() -> None:
    """全件収集バリデータ。比べるのは (path, code) の並びで、メッセージ文言は比べない
    （日本語の言い回しは TS 側を真実源にする）。warning は detail まで比べる。"""
    from app.admin.validate import validate_document

    base = load_sample_doc()

    def shape(result: dict) -> dict:
        return {
            "ok": result["ok"],
            "errors": [{"path": e["path"], "code": e["code"]} for e in result["errors"]],
            "warnings": [
                {"path": w["path"], "code": w["code"], "detail": w.get("detail") or {}}
                for w in result["warnings"]
            ],
        }

    cases = [
        {
            "name": "サンプル定義（正常）",
            "input": {"mutation": None},
            "output": shape(validate_document(base)),
        }
    ]
    for label, mutation, doc in hostile_mutations(base):
        cases.append(
            {
                "name": label,
                "input": {"mutation": mutation},
                "output": shape(validate_document(doc)),
            }
        )

    # 配当外の漢字（学年を下げると warning が出る）
    for grade in ("小1", "小3", "小6"):
        doc = load_sample_doc()
        doc["grade"] = grade
        cases.append(
            {
                "name": f"配当外漢字 {grade}",
                "input": {"mutation": {"path": ["grade"], "op": "set", "value": grade}},
                "output": shape(validate_document(doc)),
            }
        )

    # 影響警告の3種
    prev = load_sample_doc()
    added = load_sample_doc()
    added["habits"].append({"key": "", "label": "あたらしい しゅうかん"})
    cases.append(
        {
            "name": "期間中に項目を足した",
            "input": {"doc": added, "prevDoc": prev, "today": "2026-08-01"},
            "output": shape(
                validate_document(added, prev_doc=prev, today=date(2026, 8, 1))
            ),
        }
    )
    removed = load_sample_doc()
    dropped = removed["habits"].pop()
    usage = {dropped["key"]: 7}
    cases.append(
        {
            "name": "記録のある項目をけした",
            "input": {"doc": removed, "prevDoc": prev, "usage": usage},
            "output": shape(validate_document(removed, prev_doc=prev, usage=usage)),
        }
    )
    shrunk = load_sample_doc()
    shrunk["period"]["start"] = "2026-08-05"
    cases.append(
        {
            "name": "きかんの外に記録がある",
            "input": {"doc": shrunk, "recordDays": ["2026-07-25", "2026-08-31"]},
            "output": shape(
                validate_document(shrunk, record_days=("2026-07-25", "2026-08-31"))
            ),
        }
    )
    # ごほうびの上限（1日にとれる最大点＝100＋チャレンジ数×25）の境目。敵対的な値には
    # 大きい整数が無いので、スイープだけでは「上限ちょうど」と「上限+1」を作れない。
    # サンプル定義はチャレンジ4件＝200点。境目を明示的に固める（>= に変えたら落ちる）。
    for avg in (200, 201):
        doc = load_sample_doc()
        doc["rewards"][3]["avg"] = avg
        cases.append(
            {
                "name": f"ごほうび 最上位ランク avg={avg}（1日の上限は200点）",
                "input": {"mutation": {"path": ["rewards", 3, "avg"], "op": "set", "value": avg}},
                "output": shape(validate_document(doc)),
            }
        )

    # 上限超えは「そのランクだけ」に付く（順序エラーと同居しても混ざらない）
    doc = load_sample_doc()
    doc["rewards"][1]["avg"] = 999
    cases.append(
        {
            "name": "ごほうび 中位ランクだけ上限超え（順序エラーと同居）",
            "input": {"mutation": {"path": ["rewards", 1, "avg"], "op": "set", "value": 999}},
            "output": shape(validate_document(doc)),
        }
    )

    # はじめの設定（標準テンプレート）が、そのままで警告ゼロであること。テンプレートの
    # 閾値とチャレンジ数がずれた issue #28 の再発を、テンプレートと検証の交差で止める。
    from app.admin.template import empty_template, standard_template

    period = {"start": "2026-07-21", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}
    template_doc = standard_template("はな", "はな", "小2", 2026, period)
    cases.append(
        {
            "name": "標準テンプレート（作った直後は警告ゼロ）",
            "input": {"doc": template_doc},
            "output": shape(validate_document(template_doc)),
        }
    )

    # 「からっぽ」で作った直後（両区分とも空）。敵対的スイープは1パスずつしか壊さないので
    # 両方空はそこから作れず、明示しないと金型に1件も現れない——issue #34 で素通りしていた
    # のがちょうどこの形なので、区分ごとに1本ずつ警告が付くことをここで固める。
    empty_doc = empty_template("はな", "はな", "小2", 2026, period)
    cases.append(
        {
            "name": "空テンプレート（作った直後は空区分の警告が2件）",
            "input": {"doc": empty_doc},
            "output": shape(validate_document(empty_doc)),
        }
    )

    write("validate.json", cases, "全件収集バリデータの (path, code) と warning の detail")


def dump_template() -> None:
    from app.admin.template import TEMPLATES

    period = {"start": "2026-07-21", "end": "2026-08-31", "first_day_of_school": "2026-09-01"}
    cases = []
    for kind, build in TEMPLATES.items():
        for grade in ("小1", "小2", "小3", "小4", "小5", "小6", "こわれた学年"):
            cases.append(
                {
                    "name": f"{kind} / {grade}",
                    "input": {
                        "kind": kind,
                        "child": "はな",
                        "childKana": "はな",
                        "grade": grade,
                        "year": 2026,
                        "period": period,
                    },
                    "output": build("はな", "はな", grade, 2026, period),
                }
            )
    write("template.json", cases, "初回ウィザードのテンプレート（学年ごとに文言だけ変わる）")


def dump_state() -> None:
    """画面 state の一括組み立て（build_state）を、保存層の出力ごと固める。

    lite 版の buildState は DB に触らず、読み出し済みのチェック・メモ・フラグを受け取る形に
    してある。だからここでは「バックエンドが DB から読んだもの」も一緒に書き出して、
    TS 側がまったく同じ入力から同じ state を作れるかを見る。
    """
    import tempfile

    from app.admin import definition_store
    from app.db import ensure_schema
    from app.summer import service, store

    doc = load_sample_doc()
    child = doc["child"]
    cases = []

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "summer.db"
        ensure_schema(db)
        entry = definition_store.create_definition(doc, db_path=db)
        stored = entry["doc"]  # キー採番後の doc（記録と突き合わせるのはこちら）
        definition = parse_definition(stored)
        habits = [h["key"] for h in stored.get("habits", [])]
        dailies = [h["key"] for h in stored.get("daily_homework", [])]
        challenges = [h["key"] for h in stored.get("special_challenges", [])]
        one_shots = [h["key"] for h in stored.get("one_shot_homework", [])]
        preps = [h["key"] for h in stored.get("school_start_items", [])]

        def snapshot(name: str, today: date) -> None:
            checks = store.list_checks(child, definition.start, definition.end, db_path=db)
            metas = store.list_meta(child, definition.start, definition.end, db_path=db)
            flags = store.list_flags(child, db_path=db)
            cases.append(
                {
                    "name": name,
                    "input": {
                        "doc": stored,
                        "today": today.isoformat(),
                        "checks": checks,
                        "metaByDay": metas,
                        "flags": {
                            k: {"value": f.value, "decision": f.decision} for k, f in flags.items()
                        },
                    },
                    "output": service.build_state(child, today=today, db_path=db),
                }
            )

        # 1) 記録ゼロ、期間中／期間前／期間後
        snapshot("記録ゼロ・期間中", definition.start + timedelta(days=10))
        snapshot("記録ゼロ・期間の初日", definition.start)
        snapshot("記録ゼロ・期間の最終日", definition.end)
        snapshot("記録ゼロ・期間前", definition.start - timedelta(days=1))
        snapshot("記録ゼロ・期間後", definition.end + timedelta(days=1))

        # 2) 途中まで記録（丸めの境目をまたぐ）
        day = definition.start + timedelta(days=3)
        for key in habits[:1]:
            store.set_check_status(child, day, key, "done", db_path=db)
        for key in dailies[:1]:
            store.set_check_status(child, day, key, "done", db_path=db)
        snapshot("一部だけやった日", definition.start + timedelta(days=10))

        # 2.5) 宿題だけ全部やった日＝チャレンジ枠は開く（unlocked）が、せいかつが未記入なので
        # base<100 で加点は付かない。この分岐を通す state はここだけなので消さないこと。
        only_daily = definition.start + timedelta(days=2)
        for key in dailies:
            store.set_check_status(child, only_daily, key, "done", db_path=db)
        for key in challenges[:1]:
            store.set_check_status(child, only_daily, key, "done", db_path=db)
        snapshot("宿題だけ全部やった日（チャレンジは開くが加点なし）", only_daily)

        # 3) 満点＋チャレンジ（数日ぶん積む＝ごほうびランクとストリークが動く）
        for offset in range(4, 9):
            d = definition.start + timedelta(days=offset)
            for key in habits + dailies + challenges:
                store.set_check_status(child, d, key, "done", db_path=db)
        snapshot("満点が5日つづいた", definition.start + timedelta(days=10))

        # 4) やらなかった日を挟んでストリークを切る
        broken = definition.start + timedelta(days=6)
        for key in habits[:1]:
            store.set_check_status(child, broken, key, "not_done", db_path=db)
        snapshot("途中で切れたストリーク", definition.start + timedelta(days=10))

        # 5) 中止（雨天）を記録
        cancelable = [h["key"] for h in stored.get("habits", []) if h.get("cancelable")]
        if cancelable:
            store.set_check_status(
                child, definition.start + timedelta(days=5), cancelable[0], "cancelled", db_path=db
            )
            snapshot("中止をふくむ日", definition.start + timedelta(days=10))

        # 6) メモ（text / choice / duration）
        for item in definition.daily_homework:
            if not item.meta:
                continue
            meta = {}
            for field in item.meta:
                if field.type == "text":
                    meta[field.key] = "あ" * 100
                elif field.type == "choice" and field.options:
                    meta[field.key] = field.options[0].key
                elif field.type == "duration":
                    meta[field.key] = 5999
            d = definition.start + timedelta(days=4)
            store.set_check_meta(child, d, item.key, json.dumps(meta, ensure_ascii=False), db_path=db)
        snapshot("メモつき", definition.start + timedelta(days=10))

        # 7) 一回もの・じゅんび・えらぶ宿題のフラグ
        for key in one_shots[:2]:
            store.set_flag_value(child, key, 3, db_path=db)
        for key in preps[:1]:
            store.set_flag_value(child, key, 1, db_path=db)
        for group in definition.choice_homework:
            if group.options:
                store.set_flag_value(child, group.options[0].key, 1, db_path=db)
                if len(group.options) > 1:
                    store.set_decision(child, group.options[-1].key, "skip", db_path=db)
        snapshot("フラグつき・終了1週間前", definition.end - timedelta(days=6))
        snapshot("フラグつき・終了8日前", definition.end - timedelta(days=8))
        snapshot("フラグつき・期間後（じゅんびだけ出る）", definition.end + timedelta(days=1))

    # しゅくだいが空の定義。空の区分は0点固定で、ボーナスは基本点が満点の日にしか付かない
    # ＝1日の上限が 50点に下がる。画面の score_max・ごほうびの max_total・「全部できたら◯点」の
    # 文言まで、その値で組み立てられていることを固める。健全な定義だけだと
    # judge.day_score_max の引数の並びを取り違えても素通りする（8/6/4 はどう並べても200）。
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "summer.db"
        ensure_schema(db)
        thin = load_sample_doc()
        thin["daily_homework"] = []
        thin_stored = definition_store.create_definition(thin, db_path=db)["doc"]
        thin_def = parse_definition(thin_stored)
        thin_today = thin_def.start + timedelta(days=10)
        for item in thin_stored.get("habits", []):
            store.set_check_status(child, thin_today, item["key"], "done", db_path=db)
        flags = store.list_flags(child, db_path=db)
        cases.append(
            {
                "name": "しゅくだいが空（1日の上限が50点に下がる）",
                "input": {
                    "doc": thin_stored,
                    "today": thin_today.isoformat(),
                    "checks": store.list_checks(child, thin_def.start, thin_def.end, db_path=db),
                    "metaByDay": store.list_meta(child, thin_def.start, thin_def.end, db_path=db),
                    "flags": {
                        k: {"value": f.value, "decision": f.decision} for k, f in flags.items()
                    },
                },
                "output": service.build_state(child, today=thin_today, db_path=db),
            }
        )

    # 採点区分が両方とも空。記録は項目を消しても残るので、上限0点のまま total=0 の日が届く
    # （画面はこの0を分母にしないこと＝summer/scoreScale.chartScoreMax）。
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "summer.db"
        ensure_schema(db)
        empty = load_sample_doc()
        full = definition_store.create_definition(empty, db_path=db)
        empty_today = parse_definition(full["doc"]).start + timedelta(days=10)
        for item in full["doc"].get("habits", []):
            store.set_check_status(child, empty_today, item["key"], "done", db_path=db)
        # 記録を入れたあとで両区分を消す（作りかけではなく「あとから空にした」形）
        stripped = json.loads(json.dumps(full["doc"]))
        stripped["habits"] = []
        stripped["daily_homework"] = []
        saved = definition_store.save_document(child, stripped, full["revision"], db_path=db)
        empty_stored = saved["doc"]
        empty_def = parse_definition(empty_stored)
        flags = store.list_flags(child, db_path=db)
        cases.append(
            {
                "name": "採点区分が両方とも空（上限0点・記録は残る）",
                "input": {
                    "doc": empty_stored,
                    "today": empty_today.isoformat(),
                    "checks": store.list_checks(child, empty_def.start, empty_def.end, db_path=db),
                    "metaByDay": store.list_meta(child, empty_def.start, empty_def.end, db_path=db),
                    "flags": {
                        k: {"value": f.value, "decision": f.decision} for k, f in flags.items()
                    },
                },
                "output": service.build_state(child, today=empty_today, db_path=db),
            }
        )

    write("state.json", cases, "build_state（保存層の出力もそのまま入力として固めてある）")


def main() -> None:
    dump_sample()
    dump_kanji()
    dump_ui_text()
    dump_praise()
    dump_speech()
    dump_definition()
    dump_select_year()
    dump_judge()
    dump_validate()
    dump_template()
    dump_state()


if __name__ == "__main__":
    main()

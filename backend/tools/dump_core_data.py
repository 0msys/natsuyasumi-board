"""バックエンドの「データ定数」を、lite 版（TypeScript）用にそのまま書き出す。

lite 版は採点も文言も画面側で作るので、Python にある定数を TS 側にも持つ必要がある。
そこを手で書き写すと、1,026字の配当漢字や約100本の画面文言のどこか1文字がずれても
気づけない。なので写経はせず、ここから機械で書き出す。

出力先は frontend/src/lib/core/generated/。ファイル先頭に「編集するな」と書いてあり、
CI は再生成して git diff --exit-code する（Python を直して TS を忘れる、を落とす）。

  cd backend && uv run python tools/dump_core_data.py

ロジック（採点・パース・検証）はここでは出さない。あちらは TS に移植したうえで、
tools/dump_golden.py が作る入出力の金型で突き合わせる。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# backend/ を import パスに載せる（tools/dump_frontend_fixture.py と同じ理由。
# pytest は pyproject の pythonpath で入れてくれるが、素の `uv run python` では入らない）。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admin import template  # noqa: E402
from app.summer import kanji, praise, speech, ui_text  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "core" / "generated"

HEADER = """// 自動生成。手で編集しないこと。
// 生成元: backend/{source}
// 作り直す: cd backend && uv run python tools/dump_core_data.py
"""


def ts(value: object) -> str:
    """JSON として書ける値を TS リテラルにする（そのまま JSON でよい）."""
    return json.dumps(value, ensure_ascii=False, indent=2)


def write(name: str, source: str, body: str) -> None:
    path = OUT_DIR / name
    path.write_text(HEADER.format(source=source) + "\n" + body, encoding="utf-8")
    print(f"wrote {path.relative_to(OUT_DIR.parents[5])}")


def dump_kanji() -> None:
    # 並び順は原典のまま（集合にしてから並べ直すと、差分が読めなくなる）。
    grades = [
        kanji._GRADE1,
        kanji._GRADE2,
        kanji._GRADE3,
        kanji._GRADE4,
        kanji._GRADE5,
        kanji._GRADE6,
    ]
    counts = [len(g) for g in grades]
    body = (
        "/** 学年別漢字配当表（小1〜小6・計 "
        + str(sum(counts))
        + " 字）。添字0が小1。\n"
        + " *  出典: 文部科学省 小学校学習指導要領（平成29年告示）別表「学年別漢字配当表」。 */\n"
        + "export const GRADE_KANJI_SOURCE = "
        + ts(grades)
        + " as const;\n\n"
        + "/** 学年ごとの字数（"
        + " / ".join(str(c) for c in counts)
        + "）。移植の取りこぼしを検知する錠。 */\n"
        + "export const GRADE_KANJI_COUNTS = "
        + ts(counts)
        + " as const;\n"
    )
    write("kanjiTable.ts", "app/summer/kanji.py", body)


def dump_praise() -> None:
    body = (
        "/** スコア帯 × 学年帯の定型メッセージ（同じ子・同じ日なら同じ文を選ぶ）。 */\n"
        "export const PRAISE_MESSAGES: Record<string, Record<string, readonly string[]>> = "
        + ts(praise.MESSAGES)
        + ";\n\n"
        "/** 点数の一文（{score} を埋める）。 */\n"
        "export const SCORE_LINE: Record<string, string> = " + ts(praise.SCORE_LINE) + ";\n\n"
        "/** チャレンジ加点の一文（{bonus} と {total} を埋める）。 */\n"
        "export const CHALLENGE_LINE: Record<string, string> = " + ts(praise.CHALLENGE_LINE) + ";\n\n"
        "/** おでかけの日に足す一文。 */\n"
        "export const AWAY_LINE: Record<string, string> = " + ts(praise.AWAY_LINE) + ";\n"
    )
    write("praiseBank.ts", "app/summer/praise.py", body)


def dump_ui_text() -> None:
    body = (
        "/** 子ども向け画面の固定文言（最大漢字＋総ルビ）。学年ごとの表示は openForGrade が導く。 */\n"
        "export const UI_TEXT_SOURCE: Record<string, string> = "
        + ts(ui_text.UI_TEXT)
        + ";\n\n"
        "/** 配当上は出せるが語として出したくない字（字→この学年から漢字で出す）。 */\n"
        "export const UI_SHOW_FROM: Record<string, number> = " + ts(ui_text._SHOW_FROM) + ";\n"
    )
    write("uiTextSource.ts", "app/summer/ui_text.py", body)


def dump_speech() -> None:
    body = (
        "/** 「きょうやること」読み上げ文の定型（最大漢字＋総ルビ）。 */\n"
        "export const SPEECH_LINES: Record<string, string> = " + ts(speech._LINES) + ";\n\n"
        "/** 読み上げで項目名を並べる上限。 */\n"
        "export const SPEECH_LIST_MAX = " + str(speech.SPEECH_LIST_MAX) + ";\n"
    )
    write("speechLines.ts", "app/summer/speech.py", body)


def dump_template() -> None:
    body = (
        "/** 標準テンプレートの表示文言（最大漢字＋総ルビ）。学年ごとの表示は openForGrade が導く。 */\n"
        "export const TEMPLATE_LABELS: Record<string, string> = "
        + ts(template._LABELS)
        + ";\n"
    )
    write("templateLabels.ts", "app/admin/template.py", body)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dump_kanji()
    dump_praise()
    dump_ui_text()
    dump_speech()
    dump_template()


if __name__ == "__main__":
    main()

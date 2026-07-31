"""子どもページのテスト用 state フィクスチャを build_state から書き出す。

    cd backend && uv run python tools/dump_frontend_fixture.py

frontend/src/routes/__fixtures__/summerState.json を作り直す。API の形（/api/summer/state の
戻り）を変えたら実行しなおすこと。手書きすると形がすぐズレて「テストだけ通る」状態になる。

出す3枚:
  hana        … 記録ゼロの初期状態
  sora        … 別の子（切替のテスト用。項目キーは標準テンプレと同じ＝はなと同名）
  hanaPerfect … その日を満点にした状態（満点花火とランク演出が重なる条件をつくる）

ランク到達（rewards.achieved_key）は何日も積まないと立たないので、ここでは立てない。
必要なテストが自分で立てる（page.test.ts の hanaRankUp を参照）。
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
from datetime import date
from pathlib import Path

# backend/ を import パスに載せる（pytest は pyproject の pythonpath で入れてくれるが、
# 素の `uv run python` では入らない。上の使いかたがそのまま動くようにする）。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admin import definition_store  # noqa: E402
from app.db import ensure_schema  # noqa: E402
from app.summer import service, store  # noqa: E402
from app.summer.definition import load_definition  # noqa: E402

DAY = date(2026, 8, 1)
SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "examples" / "2026-はな.json"
DEST = Path(__file__).resolve().parents[2] / "frontend" / "src" / "routes" / "__fixtures__" / "summerState.json"


def _perfect(child: str, db: Path) -> None:
    """その日の記録を全部「やった」にする（採点を満点にする）."""
    definition = load_definition(child, db_path=db)
    for item in definition.daily_items():
        store.set_check_status(child, DAY, item.key, "done", db_path=db)
    for one_shot in definition.one_shot_homework:
        store.set_flag_value(child, one_shot.key, one_shot.target or 1, db_path=db)
    for prep in definition.school_start_items:
        store.set_flag_value(child, prep.key, 1, db_path=db)
    for group in definition.choice_homework:
        for option in group.options:
            store.set_flag_value(child, option.key, 1, db_path=db)


def main() -> None:
    db = Path(tempfile.mkdtemp()) / "fixture.db"
    ensure_schema(db)
    base = json.loads(SAMPLE.read_text(encoding="utf-8"))
    for name in ("はな", "そら"):
        doc = copy.deepcopy(base)
        doc["child"] = name
        doc["child_kana"] = name
        definition_store.create_definition(doc, db_path=db)

    out = {
        "hana": service.build_state("はな", today=DAY, db_path=db),
        "sora": service.build_state("そら", today=DAY, db_path=db),
    }
    _perfect("はな", db)
    out["hanaPerfect"] = service.build_state("はな", today=DAY, db_path=db)

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for key, state in out.items():
        score = state["today_score"]
        print(f"  {key}: child={state['child']} score={score['score']} total={score['total']}")
    print(f"書き出し: {DEST}")


if __name__ == "__main__":
    main()

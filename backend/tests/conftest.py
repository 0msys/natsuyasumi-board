"""共通フィクスチャ。

サンプル定義 docs/examples/2026-はな.json を単一真実源として、
- definition: パース済み SummerDefinition（純関数テスト用・DB 不要・セッション共有）
- sample_doc: 毎テスト新品の dict（破壊的ミューテーションによるエラーケース生成用）
- tmp_db:     ensure_schema 適用済みのテンポラリ DB パス
- seeded_db:  tmp_db にサンプル定義を create_definition で投入したもの
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.db import ensure_schema
from app.summer.definition import parse_definition

SAMPLE_JSON_PATH = Path(__file__).resolve().parents[2] / "docs" / "examples" / "2026-はな.json"
CHILD = "はな"


def load_sample_doc() -> dict:
    """サンプル定義 JSON を毎回ファイルから読み直す（テスト間の共有ミューテーション防止）."""
    return json.loads(SAMPLE_JSON_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def sample_doc() -> dict:
    return load_sample_doc()


@pytest.fixture(scope="session")
def definition():
    return parse_definition(load_sample_doc())


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    d = tmp_path / "summer.db"
    ensure_schema(d)
    return d


@pytest.fixture
def seeded_db(tmp_db: Path, sample_doc: dict) -> Path:
    from app.admin import definition_store

    definition_store.create_definition(sample_doc, db_path=tmp_db)
    return tmp_db


# ---- 敵対的入力スイープ（定義を読む側の「投げる例外」の契約を守るための道具） ----
#
# 定義 JSON は利用者が手で書ける・貼れる（インポート・エクスポート往復）ので、
# どの欄にどんな型が入ってくるか分からない。素の int() や for に渡すと ValueError /
# TypeError がそのまま外へ出て、呼び出し側は「定義が壊れている」と「サーバの障害」を
# 区別できなくなる。サンプル定義の全パスを総当たりで壊して、その契約を検査する。

_HOSTILE_VALUES = (None, "もじ", 0, -1, True, 1.5, [], {}, [1], {"a": 1})
_DELETE = object()  # 差し替えではなくキーごと消す印


def _doc_paths(node: object, prefix: tuple = ()):
    """dict / list を再帰して、全要素へのパス（キーと添字の列）を列挙する."""
    if prefix:
        yield prefix
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _doc_paths(value, prefix + (key,))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from _doc_paths(value, prefix + (i,))


def hostile_docs(base: dict):
    """base の各パスを敵対的な値へ差し替え／削除した doc を (説明, doc) で順に返す."""
    for path in list(_doc_paths(base)):
        for value in (*_HOSTILE_VALUES, _DELETE):
            doc = json.loads(json.dumps(base))
            parent = doc
            for step in path[:-1]:
                parent = parent[step]
            if value is _DELETE:
                del parent[path[-1]]
            else:
                parent[path[-1]] = value
            shown = "削除" if value is _DELETE else repr(value)
            yield f"/{'/'.join(map(str, path))} = {shown}", doc

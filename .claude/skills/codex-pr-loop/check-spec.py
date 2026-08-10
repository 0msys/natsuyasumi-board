#!/usr/bin/env python3
"""docs/spec/ の整合検査。リポジトリのルートで実行する。

  - 相対リンクのファイル実在と #アンカー解決（GitHub の slug 規則に合わせて約物を除去）
  - 画面機能ID（ABC-01 形式）の重複
  - 「## 実装参照」に並べたパスの実在

終了コード: 問題なしで 0、1件でもあれば 1。
"""

import glob
import os
import re
import sys
import unicodedata

SPEC_FILES = glob.glob("docs/spec/**/*.md", recursive=True)
TARGETS = SPEC_FILES + ["README.md"]

def iter_link_inners(text: str):
    """`](` の出現を全部返す。中身、または閉じ括弧が無ければ None。

    正規表現でリンク全体を書くと、当てはまらない書き方を **黙って落とす**。
    検査対象が減っても出力は「OK」のままなので、抜けたことに気づけない。
    括弧の対応は数えて追う（ネストの深さに上限を作らない）。
    見つけたものは必ず呼び出し側へ渡し、解釈できないかどうかは呼び出し側が決める。
    """
    i = 0
    while True:
        j = text.find("](", i)
        if j == -1:
            return
        k = j + 2
        depth = 1
        while k < len(text):
            if text[k] == "(":
                depth += 1
            elif text[k] == ")":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        if depth != 0:
            yield None  # 閉じ括弧が無い
            i = j + 2
        else:
            yield text[j + 2 : k]
            i = k + 1


def link_destination(inner: str) -> str | None:
    """`](...)` の中身から行き先を取り出す。解釈できなければ None。

    `[x](path "title")` のタイトルを path に含めない。含めると
    `other.md "hover text"` を1つのパスとして存在確認してしまう。
    """
    s = inner.strip()
    if not s:
        return None
    if s.startswith("<"):
        end = s.find(">")
        return s[1:end] if end != -1 else None
    m = re.fullmatch(r"""(\S+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?""", s)
    return m.group(1) if m else None


def slug(heading: str) -> str:
    """github-slugger 相当: 小文字化し、約物・記号を落とし、空白を - にする。"""
    s = heading.strip().lower()
    s = "".join(
        c
        for c in s
        if not unicodedata.category(c).startswith(("P", "S")) or c in "-_"
    )
    return s.replace(" ", "-")


def strip_code_fences(text: str) -> str:
    """``` / ~~~ で囲まれた範囲を空行に潰す（行数は保つ）。

    シェル例の中の `# コメント` を見出しとして拾うと、GitHub には存在しないアンカーを
    「在る」と記録し、壊れたリンクを通してしまう。コード例の中の `](...)` も
    リンクではないので、同じ理由でリンク検査からも外す。
    """
    out: list[str] = []
    fence: tuple[str, int] | None = None
    for line in text.split("\n"):
        if fence is None:
            m = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
            if m:
                fence = (m.group(1)[0], len(m.group(1)))
                out.append("")
            else:
                out.append(line)
            continue
        # 終端はフェンス文字だけの行で、情報文字列を持てない（CommonMark）。
        # ここを緩めて「``` で始まる行」を終端にすると、続けて置かれた ```python を
        # 終端と誤読し、そのブロックの中身が地の文へ漏れる。コード例の中の
        # `# コメント` が見出しになり、実在しないアンカーを通してしまう。
        m = re.match(r"^\s{0,3}(`{3,}|~{3,})[ \t]*$", line)
        if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= fence[1]:
            fence = None
        out.append("")
    return "\n".join(out)


def mask_inline_code(text: str) -> str:
    """`コード` を同じ長さの空白に潰す（リンク抽出の前だけに使う）。

    `` `[label](missing.md)` `` のような表記例を本物のリンクとして検査すると、
    存在しない行き先をリンク切れとして報告してしまう。GitHub はここをリンクにしない。

    見出しには使わない。`## \\`api\\` の使い方` の slug には中身が含まれるため、
    潰すとアンカーの方を誤る。
    """
    return re.sub(r"(`+)([^\n]+?)\1", lambda m: " " * len(m.group(0)), text)


def heading_texts(text: str) -> list[str]:
    """文書順の見出し文字列。ATX（`## X`）と Setext（`X` の次行に `===` / `---`）の両方。

    Setext を拾わないと、GitHub には在るアンカーを「無い」と判定し、正しいリンクを
    リンク切れとして報告する。
    """
    lines = strip_code_fences(text).split("\n")

    # YAML フロントマターを外す。閉じの `---` は直前行の Setext 下線に見える。
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break

    underline = re.compile(r"\s{0,3}(=+|-+)[ \t]*")
    out: list[str] = []
    for i in range(start, len(lines)):
        line = lines[i]
        # 3字までのインデントは見出しとして有効（CommonMark）。列0固定にすると
        # `  ## Setup` のアンカーを見落とし、正しいリンクを切れと報告する。
        # 引用の中の見出しにも GitHub はアンカーを作るので、`>` を剥がしてから見る。
        m = re.match(r"^(?:[ \t]{0,3}>)*[ \t]{0,3}#{1,6}[ \t]+(.*)$", line)
        if m:
            # ATX の閉じ側 `## 見出し ##` は見出し文ではない（CommonMark）。
            # 残すと `## Setup ##` が `setup-` になり、正しい #setup を弾いて
            # 実在しない #setup- を通す。空白が先行する # の連なりだけを落とす。
            out.append(re.sub(r"[ \t]+#+[ \t]*$", "", m.group(1)))
            continue
        if i <= start or not underline.fullmatch(line):
            continue
        prev = lines[i - 1]
        if not prev.strip():
            continue  # 空行のあとの --- は区切り線であって見出しではない
        if re.match(r"^#{1,6}[ \t]", prev) or underline.fullmatch(prev):
            continue
        if re.match(r"^\s{0,3}([-*+]|\d+[.)])[ \t]", prev):
            continue  # 箇条書きの直後は Setext にならない
        out.append(prev.strip())
    return out


def anchors_of(text: str) -> set[str]:
    """1ファイル分の見出しアンカー。github-slugger の採番をそのまま移植する。

    同じ見出しが複数あると GitHub は 2 つ目以降へ -1, -2 と採番する。ただし単純な
    連番ではない。採番した結果が既存のアンカーとぶつかる場合は、空くまで番号を進める。

        # せつめい      → せつめい
        # せつめい-1    → せつめい-1     （明示的に書かれた見出し）
        # せつめい      → せつめい-2     （-1 は埋まっているので飛ばす）

    連番で済ませると 3 つ目が せつめい-1 になり、2 つ目と衝突して せつめい-2 が
    アンカー一覧から消える。正しいリンクをリンク切れと報告してしまう。
    """
    occurrences: dict[str, int] = {}
    out: set[str] = set()
    for heading in heading_texts(text):
        original = slug(heading)
        result = original
        # 初回に入るのは result == original のときだけなので、参照は必ず存在する。
        while result in occurrences:
            occurrences[original] += 1
            result = f"{original}-{occurrences[original]}"
        occurrences[result] = 0
        out.add(result)
    return out


def main() -> int:
    # README は常に TARGETS に入るので、これを「対象あり」と数えると
    # docs/spec が丸ごと無い状態でも成功で通ってしまう。仕様書の有無で判断する。
    if not [f for f in SPEC_FILES if os.path.exists(f)]:
        print("docs/spec/ に Markdown がありません。リポジトリのルートで実行してください。")
        return 1
    files = [f for f in TARGETS if os.path.exists(f)]

    text = {f: open(f, encoding="utf-8").read() for f in files}
    anchors: dict[str, set[str] | None] = {f: anchors_of(t) for f, t in text.items()}

    def anchors_for(path: str) -> set[str] | None:
        """リンク先のアンカー集合。検査対象の外にある Markdown も読みに行く。

        検査対象（docs/spec 配下と README）だけを地図に持つと、`../definition-format.md#x`
        のような外向きリンクは「地図に無いから検査しない」で素通りする。壊れたアンカーを
        黙って通すので、Markdown なら読み足す。読めない場合は None＝検査しない。
        """
        if path not in anchors:
            try:
                with open(path, encoding="utf-8") as fh:
                    anchors[path] = anchors_of(fh.read())
            except OSError:
                anchors[path] = None
        return anchors[path]

    problems = []

    for f, t in text.items():
        d = os.path.dirname(f)
        for inner in iter_link_inners(mask_inline_code(strip_code_fences(t))):
            target = link_destination(inner) if inner is not None else None
            if target is None:
                # 落とさずに出す。黙って除外すると、検査していない事実が見えない。
                shown = "閉じ括弧なし" if inner is None else f"]({inner})"
                problems.append(f"リンクを解釈できません: {f} -> {shown}")
                continue
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            path, _, frag = target.partition("#")
            resolved = f if not path else os.path.normpath(os.path.join(d, path))
            if path and not os.path.exists(resolved):
                problems.append(f"リンク切れ（ファイル）: {f} -> {target}")
                continue
            if not frag or not resolved.endswith(".md"):
                continue
            known = anchors_for(resolved)
            if known is not None and frag not in known:
                problems.append(f"リンク切れ（アンカー）: {f} -> {target}")

    ids = []
    for f in glob.glob("docs/spec/screens/*.md"):
        ids += re.findall(r"^\|\s*([A-Z]{3}-\d{2})\s*\|", text.get(f, ""), re.M)
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        problems.append(f"画面機能IDの重複: {', '.join(dups)}")

    refs = set()
    for f, t in text.items():
        parts = re.split(r"^## 実装参照\s*$", t, flags=re.M)
        if len(parts) < 2:
            continue
        # 次の ## までで切る。末尾まで読むと、後続セクションの `コード` 付き箇条書きを
        # 実装参照のパスと誤認して、無関係な例で検査全体が落ちる。
        section = re.split(r"^##\s", parts[1], flags=re.M)[0]
        for line in section.splitlines():
            m = re.match(r"-\s*`([^`]+)`", line.strip())
            if m:
                refs.add(m.group(1))
    for r in sorted(refs):
        if not os.path.exists(r.split(":")[0]):
            problems.append(f"実装参照が存在しない: {r}")

    print(f"検査対象 {len(files)} ファイル / 画面機能ID {len(ids)} 件 / 実装参照 {len(refs)} 件")
    if problems:
        for p in problems:
            print("  NG:", p)
        return 1
    print("  OK: リンク・アンカー・ID重複・実装参照とも問題なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())

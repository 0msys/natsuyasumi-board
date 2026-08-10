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

TARGETS = glob.glob("docs/spec/**/*.md", recursive=True) + ["README.md"]


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
        m = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if fence is None:
            if m:
                fence = (m.group(1)[0], len(m.group(1)))
                out.append("")
            else:
                out.append(line)
        else:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= fence[1]:
                fence = None
            out.append("")
    return "\n".join(out)


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
    # `\s+` にすると改行も食う。見出しが「## 」だけの行だと次の行まで飲み込んで
    # 1つの見出しとして誤読するので、行内の空白だけに限る。
    for heading in re.findall(r"^#{1,6}[ \t]+(.*)$", strip_code_fences(text), re.M):
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
    files = [f for f in TARGETS if os.path.exists(f)]
    if not files:
        print("docs/spec/ が見つかりません。リポジトリのルートで実行してください。")
        return 1

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
        for m in re.finditer(r"\]\(([^)]+)\)", strip_code_fences(t)):
            target = m.group(1)
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

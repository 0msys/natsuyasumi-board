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


def anchors_of(text: str) -> set[str]:
    """1ファイル分の見出しアンカー。

    同じ見出しが複数あると GitHub は 2 つ目以降へ -1, -2 と採番する。
    素の slug だけを集めると、正しい #foo-1 をリンク切れと誤判定する。
    """
    seen: dict[str, int] = {}
    out: set[str] = set()
    for heading in re.findall(r"^#{1,6}\s+(.*)$", text, re.M):
        base = slug(heading)
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.add(base if n == 0 else f"{base}-{n}")
    return out


def main() -> int:
    files = [f for f in TARGETS if os.path.exists(f)]
    if not files:
        print("docs/spec/ が見つかりません。リポジトリのルートで実行してください。")
        return 1

    text = {f: open(f, encoding="utf-8").read() for f in files}
    anchors = {f: anchors_of(t) for f, t in text.items()}

    problems = []

    for f, t in text.items():
        d = os.path.dirname(f)
        for m in re.finditer(r"\]\(([^)]+)\)", t):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            path, _, frag = target.partition("#")
            resolved = f if not path else os.path.normpath(os.path.join(d, path))
            if path and not os.path.exists(resolved):
                problems.append(f"リンク切れ（ファイル）: {f} -> {target}")
                continue
            if frag and resolved in anchors and frag not in anchors[resolved]:
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
        for line in parts[1].splitlines():
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

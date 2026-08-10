---
name: codex-pr-loop
description: PR を出してから Codex レビューが指摘なしになるまでを自動で回す。@codex review の依頼、監視の常駐、指摘の検証と修正、スレッド返信、再依頼を繰り返し、「指摘なし」の要約が現在の HEAD を対象にしていることで完了と判定する。「PRを出して」「レビューを回して」「指摘に対応して」「PRを完了まで進めて」と言われたとき、また既存 PR のレビュー往復を任されたときに使う。
---

# Codex レビュー往復ループ

PR を出してからレビューが通るまでを、指摘 → 検証 → 修正 → 返信 → 再依頼で回す。

このリポジトリには Codex の PR レビューが設定されている。

## 完了シグナル（最重要）

結果の届き方は、指摘の有無で**経路が変わる**。

| ラウンド | 届く場所 | 本文 |
|---|---|---|
| 指摘なし | **issue コメント** | `Codex Review: Didn't find any major issues. ...` |
| 指摘あり | **review レコード**の body ＋インラインコメント | `### 💡 Codex Review` … |

**合格を知る経路は issue コメントだけ。** `pulls/<pr>/reviews` と `pulls/<pr>/comments`
（インライン）しか見ていないと、合格が永久に見えず「レビューが来ない」と誤読する。

どちらも対象コミットを持つ。issue コメントは本文の `**Reviewed commit:** \`<sha>\``、
review レコードは `.commit_id`。**その sha が現在の HEAD と一致することまで確かめる。**
追い越された古いコミットへの合格を、HEAD の合格と読まない。

```bash
BOT='chatgpt-codex-connector[bot]'
head_sha=$(gh api repos/OWNER/REPO/pulls/PR --jq '.head.sha')
sid=$(gh api repos/OWNER/REPO/issues/PR/comments --paginate --slurp \
        | jq -r "[.[][] | select(.user.login == \"$BOT\")] | .[-1].id // \"\"")
if [ -n "$sid" ]; then
  gh api repos/OWNER/REPO/issues/comments/$sid --jq '.body' | head -3
else
  echo "要約なし（まだレビューされていない）"
fi
echo "HEAD=$head_sha"
```

> **ページングの罠。** `--paginate` に `--jq` を付けるとフィルタが**ページごと**に走る。
> `[...] | length` は各ページの件数を並べ、`.[-1]` はページごとの末尾を並べる。件数が過少になり、
> ID は複数行になって後続の API 呼び出しが必ず失敗する。集約するときは `--paginate --slurp` で
> 生 JSON を取り、`jq` を外で通して `.[][]` で平坦化する（`--slurp` は `--jq` と併用できない）。
> 各要素をそのまま流すだけなら `--jq` のままでよい。

補助シグナル（決め手にしない）:

- **👍**（PR 本体へのリアクション）。(user, content) で一意なので、2ラウンド続けて指摘なしでも
  増えない。「👍 が在る」だけでは今回のラウンドの合格を意味しない。
- **👀**（依頼コメントへのリアクション）＝受理。付かないまま処理されることもあるので、
  無いことを未着手の証拠にしない。

## 手順

### 1. PR を作る（既存 PR を引き継ぐ場合は 2 から）

ブランチを push し、`gh pr create` する。本文には確認項目を書く。

### 2. 現状を確認してから監視を張る

**順序を守ること。** 監視スクリプトは起動時に「いま在るもの」を既読としてシードするので、
先に届いていたレビューを黙って飲み込む。

```bash
# 直近のレビュー（指摘ありの経路）
gh api repos/OWNER/REPO/pulls/PR/reviews --paginate \
  --jq '[.[] | select(.user.login=="chatgpt-codex-connector[bot]")] | .[-3:] | .[] | "\(.id) \(.commit_id[0:7]) \(.submitted_at)"'
# 合格の要約（指摘なしの経路。ここを見落とすと合格に気づけない）
gh api repos/OWNER/REPO/issues/PR/comments --paginate \
  --jq '.[] | select(.user.login=="chatgpt-codex-connector[bot]") | "\(.id) \(.created_at)"'
# 未返信の指摘が無いかを in_reply_to_id で突き合わせる（下の「未返信の洗い出し」）
```

未対応の指摘があれば先に片づけてから、監視を起動する。

```
Monitor(
  command: bash <skill-dir>/watch-pr.sh OWNER/REPO PR <state-dir>
  persistent: true
)
```

出る行: `CLEAN` / `CLEAN-STALE` / `SUMMARY` / `THUMBSUP` / `REACTION` / `UNLIKED` / `ACK` /
`REVIEW` / `COMMENT` / `CI-FAIL` / `QUIET` / `WARN` / `RECOVERED`。

`UNLIKED` は承認リアクションが外れたときだけ出る。Codex はレビュー開始時に 👀 を付け、
完了時に外す。これを承認の撤回として鳴らすと毎ラウンド誤報になるので、対象外にしてある。

通信に失敗した周期は、判定を出さず印も付けずに次へ回す。`WARN` は「HEAD が取れず判定を
保留している」という意味で、**沈黙が異常なしを意味しないこと**を知らせるために出る。

HEAD との照合はスクリプトが行う。**完了と読んでよいのは `CLEAN` だけ**で、
`CLEAN-STALE` は「追い越された古いコミットが通っただけ」を意味する。
`REVIEW` 行にも照合結果が付く。

状態ファイルは手で触らない。スクリプトが出した行だけを印として記録するので、
外から追記すると、その瞬間に届いた指摘を飲み込む。

### 3. レビューを依頼する

**push が先、依頼が後。** 逆だと古い HEAD をレビューされる。

```bash
git push origin <branch> && gh pr comment PR --repo OWNER/REPO --body "@codex review"
```

1 回の push につき 1 回だけ。連投しない。

### 4. 指摘が来たら

```bash
gh api repos/OWNER/REPO/pulls/PR/comments --paginate \
  --jq '.[] | select(.pull_request_review_id == REVIEW_ID) | "=== \(.id) | \(.path):\(.line // .original_line)\n\(.body)\n"'
```

1. **実装で裏を取る。** 該当ファイルを読み、file:line で確認する。誤検知なら直さず、
   根拠を添えて返信する。今のところ Codex の指摘はすべて妥当だった。
2. **同じ主張が他所にも無いか grep する。** 1件の指摘が3〜4ファイルに散っていることが多い。
   画面一覧の表・詳細ページ・共通ページ・テスト観点はセットで直す。
3. **検査を回す。** PR 本文に書いた確認項目を毎ラウンド全部。
4. commit → push → **スレッドへ個別に返信** → `@codex review`。

返信は `replies` エンドポイントへ。まとめてではなく1件ずつ。

```bash
gh api repos/OWNER/REPO/pulls/PR/comments/COMMENT_ID/replies -f body='...'
```

返信には「確認した実装の file:line」「直した内容」「コミット sha」を入れる。

### 5. 完了

次の3つが揃ったときだけ「通った」と言う。

1. `CLEAN` が出ている（＝「指摘なし」の要約の対象が**現在の HEAD と一致**）
2. 未返信の指摘がゼロ
3. CI が緑

1つでも欠けたら、欠けている事実をそのまま報告する。監視が黙っていることを合格の根拠にしない。

マージは指示されない限りしない。

## 自分の修正が次の指摘を生む型

**このループで最も多い失敗。** 指摘を直す文の中で、新しい過剰主張を作ってしまう。

実例（すべて指摘された）:

- 「記録の操作と**音声読み上げ**の失敗は6秒で消える」→ 自動読み上げは握り潰されていた
- 「版差は**保存の持ちかた**から生まれるものだけ」→ 音声・PIN の差がある
- 「差が出るのは**3項目**」→ 直したつもりが、まだ網羅の主張
- 「**チェックかチャレンジの操作**で音が解放される」→ ○ へ変えたときだけ
- 「花火と**効果音**は出る」→ 効果音は解放前だと鳴らない
- 「**既定の声**へ落として鳴らす」→ 既定が一覧に無ければ先頭の話者

対策:

1. **条件を書く前に、その条件を作っている関数の呼び出し元を全部 grep する。**
   `unlockSummerSfx` を1箇所読んだ時点で書き始めたのが失敗だった。
2. **傘をかけない。** 「Xなど」「Xだけ」「XとY」で束ねる前に、束ねた全要素が同じ挙動か確かめる。
   確かめられないなら列挙する。
3. **同じ規則を2ファイルに書き写さない。** 1箇所に置いて相互参照する。
   フォールバック順序を2箇所に書いた結果、片方だけ古くなった。
4. **誘導が目的なら、ポインタだけ置く。** 集合を境界づける文を足さない。

## 見出しとアンカー

見出しに `「」` などの約物を入れない。アンカー生成が処理系依存になる。
相対リンクの `#fragment` は Unicode 約物を除去した slug で検査すること。

## 未返信の洗い出し

```bash
python3 - <<'EOF'
import json,subprocess
R="OWNER/REPO"; PR="<対象の PR 番号>"; ME="<自分のログイン名>"
# --slurp を付けないと、ページごとに独立した JSON 配列が並んで json.loads が
# JSONDecodeError: Extra data で落ちる。付けたうえで平坦化する。
pages=json.loads(subprocess.run(['gh','api',f'repos/{R}/pulls/{PR}/comments',
                                 '--paginate','--slurp'],
                                capture_output=True,text=True).stdout)
d=[c for page in pages for c in page]
tops=[c for c in d if c['user']['login']!=ME and not c.get('in_reply_to_id')]
replied={c.get('in_reply_to_id') for c in d if c['user']['login']==ME}
un=[c for c in tops if c['id'] not in replied]
print(f"指摘 {len(tops)} 件 / 未返信 {len(un)} 件")
for c in un: print(" ", c['id'], c['path'], c['created_at'])
EOF
```

## 仕様書 PR の検査

`docs/spec/` を触る PR では `check-spec.py` を毎ラウンド回す。
相対リンク＋アンカー、画面機能ID の重複、実装参照パスの実在を見る。

```bash
python3 <skill-dir>/check-spec.py
```

## 報告

利用者へは毎ラウンド、次を伝える。

- 指摘の内容と、実装で確認した根拠（file:line）
- 直した範囲（他ページへの波及を含む）
- 回した検査と結果
- コミット sha と、次のレビュー依頼を出したこと

レビューが通っていないのに通ったと言わない。監視が黙っていることを「指摘なし」の根拠にしない。

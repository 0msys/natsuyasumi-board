# 計画: 画面の固定文言を学年帯で切り替える

**状態**: 完了（実装済み。以下は起票時の調査記録として残す）
**起票**: 2026-07-25
**実装**: 2026-07-26 — 学年帯（low/mid/high）ではなく**小1〜小6の学年単位**で実装した。
文言は `backend/app/summer/ui_text.py` の `UI_TEXT` に1本だけ最大漢字＋総ルビで書き、
学年ごとの表示は `kanji.open_for_grade()` が導出する（サーバが `/api/summer/state` の
`ui` 欄で配る）。全学年ぶんの出力は `backend/tests/ui_text_snapshot.json` が固定している。
下の対象ファイル表のうち `HamigakiCardGuide.svelte` は、はみがきカレンダー機能ごと削除済み。

## なにをするか

子ども向け画面にハードコードされている見出し・ボタン・説明文を、子どもの学年帯
（low=小1-2 / mid=小3-4 / high=小5-6）に応じて書き分けられるようにする。
小6の画面でも「しんがっきのじゅんび」「せいかつ」と全部ひらがなで出ている状態を解消する。

## なぜ

定義データ側は既に学年帯対応が済んでいる:

- 標準テンプレートの項目名 — `backend/app/admin/template.py` の `_LABELS`
  （小1「おんどく」／小5「音読《おんどく》」）
- きょうのがんばりコメント — `backend/app/summer/praise.py` の `MESSAGES` ほか
  （low「きょうは 80てんだよ。」／high「今日《きょう》は80点《てん》だよ。」）

一方で画面の固定文言は全学年共通のまま。結果として**同じ画面に学年相応のデータ由来ラベルと
小1相当の固定文言が混在**する。小6の画面で「音読《おんどく》」の隣に「せいかつ」が並ぶ。

## 現状の把握（調査済み）

- **文言を一元管理する辞書は存在しない**。各 `.svelte` に直書き。
  i18n ライブラリも入っていない（`frontend/package.json` の依存は `@lucide/svelte` のみ、
  `messages/` 等のディレクトリも無し）
- **学年は API で既にフロントまで届いている** — `SummerState.grade`
  （`backend/app/summer/service.py:276` → `frontend/src/lib/api/types.ts:137`）。
  ただし子ども向けコンポーネントは誰も読んでいない実質デッドフィールド
  （`grep -rn "\.grade" frontend/src | grep -v admin` が0件）。
  **＝データの配線は不要で、参照するところから始められる**
- 学年→帯の変換はフロントにも部品がある: `gradeLevelOf()`（`frontend/src/lib/admin/docTypes.ts:68`）

## 対象範囲（実測）

子ども向け画面の固定文言は **約86箇所 / 15ファイル**（本文テキスト ＋ `placeholder`・`aria-label`・`title` 属性）。

| ファイル | 箇所 |
|---|---|
| `SummerHomeworkProgress.svelte` | 14 |
| `SummerRewardChart.svelte` | 9 |
| `SummerMediaTimerOverlay.svelte` | 8 |
| `routes/+page.svelte` | 8 |
| `SummerCheckButtons.svelte` | 7 |
| `SummerCommentCard.svelte` | 6 |
| `SummerHistoryGrid.svelte` | 6 |
| `SummerSpecialChallenge.svelte` | 6 |
| `SummerDayEditModal.svelte` | 5 |
| `SummerTodayChecks.svelte` | 5 |
| `SummerSchoolStartItems.svelte` | 4 |
| `SummerStopwatch.svelte` | 3 |
| `SummerMetaInputs.svelte` | 2 |
| `SummerMediaTimerChip.svelte` | 1 |

管理画面（`frontend/src/lib/admin/`）は**対象外**。読むのは親なので学年で変える必要がない。

## 進め方（案）

1. **文言を1箇所に集める** — 帯ごとの文言表を作る。`backend/app/admin/template.py` の `_LABELS` と同じ形
   （キー → 帯 → 文字列）。まずは全帯に現行のひらがな文言を入れて丸ごと差し替え、
   **見た目が1ドットも変わらない状態でコミット**する（純粋な機械置換として検証しやすくする）
2. **帯を導出して参照する** — `SummerState.grade` を読み、帯を決めて文言表を引く
3. **mid / high の文言を書く** — ここが実質いちばん重い。86箇所 × 2帯ぶんの日本語を書く作業
4. **配当漢字の機械照合を足す** — 書いた文言がその帯の配当に収まっているかをテストで守る
   （`backend/tests/test_summer_kanji.py` の `test_標準テンプレートのラベルが学年帯の配当内` と同じ形）

## 決めること（未決・着手前に判断が必要）

- **文言表をどこに置くか**
  - フロント（`frontend/src/lib/summer/labels.ts`）: SSR と相性がよく表示が速い。
    ただし配当 lint のテストをフロント側にもう一組作ることになる
  - バックエンド（`app/summer/` に置いて API か SSR 初期値で配る）: `kanji.py` の配当表と
    同じテストで守れて二重管理がない。API のペイロードと SSR 初期値の扱いが増える
  - → **バックエンド寄りを推す**。配当照合の安全網が既に backend にしか無いため
- **帯の定義をどう共有するか** — `backend/app/summer/kanji.py` の `GRADE_BANDS` が真実源。
  フロントに帯判定を持たせると二重管理になるので、**API が帯（`"low"|"mid"|"high"`）を
  そのまま返す**のが安全（`SummerState` に `grade_band` を足す）
- **`aria-label` も帯で変えるか** — 画面に出ないので据え置きでよいかもしれない。
  ただし読み上げ支援を使う子には影響する
- **学年と独立した「かなモード」を用意するか** — 「うちの子は漢字が苦手なので全部かなで」
  という要望はありうる。学年帯とは別の軸になる

## 参考にする既存実装

- 帯ごとの文言表: `backend/app/admin/template.py` の `_LABELS`
- 帯の定義（単一真実源）: `backend/app/summer/kanji.py` の `GRADE_BANDS` / `BAND_LINT_GRADE`
- 配当照合テスト: `backend/tests/test_summer_kanji.py`
- ルビ記法のパーサ: `frontend/src/lib/summer/ruby.ts`（`parseRuby` / `stripRuby`）

## 注意

- 文言を漢字＋ルビにすると `stripRuby()` の結果が読み上げテキストになる。
  標準テンプレでは全帯で読みが一致することを確認済み（学年で発音が変わらない）。
  同じ性質を固定文言でも保つこと
- 「寝」のように教育漢字1,026字に無い字は、どの帯でもかな書きのままにする

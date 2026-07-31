"""夏休みチェックのドメイン層。

definition = 定義ドキュメント（DB の JSON）の検証・dataclass 化
judge      = 判定・採点の純関数（DB/IO に触れない）
store      = 記録の永続化（summer_daily_checks / summer_flags / summer_media_timer）
service    = 定義＋store＋judge を束ねる層（画面 state の組み立て・書き込み検証）
praise     = 「きょうのがんばり」定型メッセージ（決定的・LLM 不使用）
speech     = 「きょうやること」読み上げテキストの組み立て
kanji      = 学年別漢字配当（小1〜小6・1026字）とルビ処理
"""

"""管理画面のバックエンド層。

definition_store = 定義ドキュメントの保存・履歴・改名・利用状況（DB 読み書き）
validate         = 全件収集バリデータ（画面向け。最終ゲートは definition.parse_definition）
template         = ウィザードの標準テンプレート（コード定数）
auth             = ADMIN_PIN による軽量ゲート（いたずら防止・認証ではない）
"""

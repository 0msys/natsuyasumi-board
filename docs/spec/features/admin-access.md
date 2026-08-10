# 管理画面へのアクセス

## Docker 版

起動時に次のどちらかを明示します。

- `ADMIN_PIN`: 管理画面に簡易 PIN ゲートを設けます。
- `ADMIN_NO_AUTH=1`: 家庭内 LAN で PIN なし運用を選びます。

どちらもない場合、Docker Compose の起動ガードは起動を中止します。
backend と frontend のコンテナは立ち上がりません。

起動ガードを経ない手動セットアップで両方とも設定しなかった場合は、管理機能を無効にします。
一覧や編集内容は表示せず、起動設定の案内を表示します。

## PIN

- PIN が必要で未認証の場合は、管理画面の代わりに入力欄を表示します。
- PIN が空の間と送信中は実行できません。
- 成功すると HttpOnly Cookie を保存し、元の画面を読み直します。
- 失敗すると「PIN がちがいます」と表示します。
- Cookie の有効期間は30日です。
- 誤入力は接続元単位で遅延させます。

PIN は子どもの誤操作を防ぐ簡易ゲートです。インターネット公開用の認証ではありません。

## lite 版

サーバがないため PIN を表示しません。
管理操作は同じ端末内のデータへ直接作用します。

## 接続エラー

セッション状態を取得できない場合は、管理内容を表示せず再読込を促します。

## テスト観点

- Docker Compose で管理方法が未設定なら起動しないこと
- 手動セットアップにおける PIN 必須、PIN 不要、管理無効の3状態
- 正しい PIN と誤った PIN
- 認証 Cookie 取得後の画面再読込
- 管理無効時に編集 UI を表示しないこと
- セッション取得失敗時に管理データを取得しないこと
- lite 版で PIN を表示しないこと

## 実装参照

- `docker-compose.yml`
- `frontend/src/lib/admin/PinGate.svelte`
- `frontend/src/lib/admin/AdminDisabledNotice.svelte`
- `backend/app/admin/auth.py`
- `backend/app/routers/admin.py`

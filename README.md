# CareRecord

CareRecordは、訪問介護事業者向けの介護記録・シフト・帳票管理アプリです。準拠状況と運用上の証跡は[docs/compliance/README.md](docs/compliance/README.md)にまとめています。

## 開発

Node.js 24 と Docker を使います。依存関係をインストールし、ローカル Supabase を起動して、リポジトリで管理するマイグレーションを適用します。

```sh
npm ci
npx --yes supabase@2.108.0 start
npx --yes supabase@2.108.0 db reset
```

`.env.example` を `.env.local` にコピーします。`APP_ENV=local` を設定し、通常のローカル作業では外部連携を無効にしてください。`npx --yes supabase@2.108.0 status --output env` が表示するローカル API URL、anon key、service-role キーを設定します。`.env.local` は Git で追跡しないでください。ローカル開発や E2E にホスト済みプロジェクトの認証情報を使わないでください。

```sh
npm run dev
```

詳しい手順は[開発環境のセットアップ](docs/development.md)と[テスト手順](docs/testing.md)を参照してください。

## リリース手順

通常は `feature/*` から PR を作成し、`main` に統合します。常設の `staging` ブランチは必須ではありません。一人の担当メンテナーが PR を作成し、差分と検査結果を確認したうえで、PR に短いリリースノートを記録します。リリース記録には候補 SHA、関連する CI 結果、該当する場合はデータベースマイグレーションの結果、デプロイ URL とスモークテストの結果を含めます。

アプリは Vercel の Git 連携でデプロイする方針です。既存の `care-record` Production 用プロジェクトと `care-record-staging` Preview 用プロジェクトを維持し、Supabase プロジェクトと環境変数はそれぞれ分けます。想定構成では、`care-record` が `main` のコミットを Production にデプロイし、`care-record-staging` が feature ブランチの Preview をデプロイします。両プロジェクトの存在とブランチ設定は確認済みです。残るセットアップ確認事項は[デプロイ手順](docs/deployment-runbook.md)に記載しています。このデプロイ経路を運用可能とみなす前に、設定を確認してください。

データベース変更は、後方互換性を保ち、データベースを先に更新する手動リリース手順で行います。

1. マイグレーションの差分と候補 SHA を確認します。既存の staging データベースにマイグレーションを適用し、対応する Preview の動作を確認します。
2. Production に適用する前に、link 済みの Supabase プロジェクト、マイグレーション履歴、dry-run を確認します。Production の最新バックアップも確認します。
3. 現行アプリが拡張後のスキーマでも動作する状態で、互換性のあるマイグレーションを Production に適用します。
4. PR をマージします。Vercel の Git 連携が `main` のコミットをデプロイします。
5. `/api/health`、サインイン、最小限の記録保存を確認します。スキーマの削除や名前変更を伴う変更は、expand、migrate、contract の順に進めます。

アプリのロールバックとデータベースの復旧は別の操作です。Vercel のアプリデプロイを戻しても、データベースマイグレーションは元に戻りません。初期設定、マイグレーション、リリース、監視、ロールバックの詳細は[デプロイ手順](docs/deployment-runbook.md)を参照してください。

## 検査

PR では設定済みの基本 CI 検査を実行し、変更ファイルに応じて追加の検査を選択します。ローカル Supabase を使う E2E では合成データを使用し、クラウド E2E 用のシークレットは使いません。現在のスクリプトと検査対象の選択規則は[テスト手順](docs/testing.md)、外部のブランチ保護の設定状況は[デプロイ手順](docs/deployment-runbook.md)を参照してください。

通常のリリースで行う検査は必要な範囲に絞っています。サービスの初回運用開始や重要な変更時は[リリース準備チェックリスト](docs/release-readiness-checklist.md)を、通常のリリースや定期運用は[デプロイ手順](docs/deployment-runbook.md)を参照してください。

## セキュリティ上重要な設定

staging と Production の環境変数は、それぞれ対応する Vercel プロジェクトに設定します。Supabase のキー、service-role key、OAuth 認証情報、連携用シークレットは環境ごとに分けてください。サーバー専用の値に `NEXT_PUBLIC_` を付けないでください。アプリケーション変数の名前と用途は `.env.example` に記載しています。

現在使う Google トークンの暗号化キーは、base64 でエンコードしたランダムな 32 バイト値にしてください。キーをローテーションする間は、既存トークンの復号に必要な古いキーリングの項目も残してください。GAS エンドポイントは期限切れの timestamp と再利用された nonce を拒否し、`GAS_SHARED_SECRET` を使って `<timestamp>.<nonce>.<request-body>` に対する HMAC-SHA256 として `X-CareRecord-Signature` を検証する必要があります。

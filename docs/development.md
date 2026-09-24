# 開発環境

## セットアップ

Node.js 24、npm、Docker を用意し、次の順にローカル環境を起動します。

```sh
npm ci
npx --yes supabase@2.108.0 start
npx --yes supabase@2.108.0 db reset
```

`.env.example` を `.env.local` にコピーします。`APP_ENV=local` にして、
通常の開発では `EXTERNAL_INTEGRATIONS_ENABLED=false` を使います。ローカル
Supabase が表示する API URL、`ANON_KEY`、`SERVICE_ROLE_KEY` を
`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、
`SUPABASE_SERVICE_ROLE_KEY` に設定します。URL とキーは次のコマンドで確認できます。

```sh
npx --yes supabase@2.108.0 status --output env
```

`.env.local` はコミットしません。ホスト済み Supabase のキーをローカル開発や
E2E に使用しないでください。ローカルスタックを止める場合は
`npx --yes supabase@2.108.0 stop --no-backup` を実行します。

```sh
npm run dev
```

E2E のデータ準備とテスト手順は[テスト手順](testing.md)を参照してください。

## マイグレーション

- 新しい変更は `npx --yes supabase@2.108.0 migration new <name>` で新規ファイルに追加します。
- 共有環境へ適用済みの migration や `supabase/migrations/old/` の歴史的
  アーカイブを編集・削除しません。
- ローカルでは `npx --yes supabase@2.108.0 db reset` で空の状態から再構築します。
- Staging と Production への手動適用手順、Project ref の確認、dry-run、
  バックアップ確認は[デプロイ手順](deployment-runbook.md)に従います。
- RLS と権限の変更は `.claude/rules/supabase.md` の実装ルールにも従います。

## ブランチとデプロイ

日常の変更は `feature/*` ブランチから PR を作成し、確認後に `main` へ
マージします。常設の `staging` ブランチは必須ではありません。既存の Staging 用 Supabase と
Vercel Preview プロジェクトは、ホスト済み Auth・Storage・外部連携の動作確認に使います。Production と Staging の値は共有しません。

アプリは Vercel Git 連携でデプロイする方針です。データベースのマイグレーションは手動で
Staging、Production の順に適用し、Production では適用前に最新バックアップと
dry-run を確認します。変更の全手順と現在の外部設定状態は
[デプロイ手順](deployment-runbook.md)を参照してください。

## CI と運用

PR の基本 CI、変更パスに応じて実行する追加チェック、依存脆弱性と秘密情報の
スキャンを使います。変更別の実行条件と正確なコマンドは
[テスト手順](testing.md)にまとめています。

完全 DB backup、backup freshness、外形 health probe はアプリ配備と別の
定期運用です。成功実績は workflow 実行記録で確認します。運用の周期、障害対応、
現在の確認事項は[デプロイ手順](deployment-runbook.md)と
[バックアップ・復旧・BCP](compliance/backup-restore-bcp.md)を参照してください。

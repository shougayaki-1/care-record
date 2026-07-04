# 開発環境

## セットアップ

1. `npm install`
2. `.env.example` を基に `.env.local` を作成する。サーバ専用変数
   （`SUPABASE_SERVICE_ROLE_KEY`, `GAS_SHARED_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY(S)`,
   `AUDIT_IP_HASH_SALT`, `CRON_SECRET` など）に `NEXT_PUBLIC_` を付けない。
3. `supabase start` でローカルSupabaseを起動（DB: `127.0.0.1:54322`）。
4. マイグレーションを適用してから `npm run dev`。

## マイグレーション運用

- 新規追加のみ: `supabase migration new <name>`。
- 既存の適用済みファイル、および `supabase/migrations/old/`（本番導入前の
  歴史的アーカイブ）は編集しない。
- RLS/権限に関わる変更は `.claude/rules/supabase.md` の手順に従う。

## デプロイ

- Vercel。cron は `vercel.json` で定義（purge / archive-audit / backup-daily / backup-monthly）。
- デプロイ前提条件（マイグレーション適用、環境変数、GASエンドポイントのHMAC検証設定など）は
  `README.md` の「Security-sensitive deployment steps」を参照。

## CI（要確認）

- `.github/workflows/playwright.yml` と `security.yml` は現在 `if: false` で無効化されている。
  意図的な一時停止か恒久停止かは未確認。再有効化の判断が必要な場合はユーザーに確認する。
- `keep_alive.yml` はSupabase無料枠のスリープ防止用の定期pingで、テストではない。

# テスト実行ルール

- コードを変更したら、最低限 `npm run typecheck` と `npm run lint` を実行する。
- `src/app/actions/*` や `src/utils/*` のロジック変更 → `npm run test:unit`
- `src/components/ui/*` の変更 → `npm run test:ui`（対応する Storybook ストーリーも更新する）
- `permissions.ts` や `supabase/migrations/*` の変更 → ローカルSupabaseでマイグレーション適用
  → `supabase/tests/security_hardening.test.sql` → 関連 unit テスト
- E2E には `npm run test:e2e:critical` または `npm run test:e2e` を使う。
  runner は使い捨てのローカル Supabase を起動し、ホスト済み URL への接続を拒否する。
- 実行していない検証を「確認済み」「テスト済み」と報告しない。失敗した場合は、その結果をそのまま報告する。

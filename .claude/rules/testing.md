# テスト実行ルール

- 変更したら最低限 `npm run typecheck` と `npm run lint` を実行する。
- `src/app/actions/*` や `src/utils/*` のロジック変更 → `npm run test:unit`
- `src/components/ui/*` の変更 → `npm run test:ui`（+ 対応するStorybookストーリー更新）
- `permissions.ts` や `supabase/migrations/*` の変更 → ローカルSupabaseでマイグレーション適用
  → `supabase/tests/security_hardening.test.sql` → 関連 unit テスト
- E2E は `npm run test:e2e:critical` または `npm run test:e2e` を使用する。
  runner は使い捨てのローカルSupabaseを起動し、ホスト済みURLを拒否する。
- 実行していない検証を「確認済み」「テスト済み」と報告しない。失敗はそのまま報告する。

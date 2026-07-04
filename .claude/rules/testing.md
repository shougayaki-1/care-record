# テスト実行ルール

- 変更したら最低限 `npm run typecheck` と `npm run lint` を実行する。
- `src/app/actions/*` や `src/utils/*` のロジック変更 → `npm run test:unit`
- `src/components/ui/*` の変更 → `npm run test:ui`（+ 対応するStorybookストーリー更新）
- `permissions.ts` や `supabase/migrations/*` の変更 → ローカルSupabaseでマイグレーション適用
  → `supabase/tests/security_hardening.test.sql` → 関連 unit テスト
- E2E（`npm run test:e2e`）はテスト専用環境（`E2E_TEST_ENV=true`）が必要なため、
  勝手に実行せずユーザーに確認する。
- 実行していない検証を「確認済み」「テスト済み」と報告しない。失敗はそのまま報告する。

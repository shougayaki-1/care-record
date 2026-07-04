# テスト

| 種別 | コマンド | 対象 | 前提 |
|---|---|---|---|
| unit | `npm run test:unit` | `src/**/*.test.ts`（Vitest, node環境） | なし |
| UI | `npm run test:ui` | Storybookストーリー（chromiumブラウザ） | Playwrightブラウザ導入済み |
| E2E | `npm run test:e2e` | `tests/*.spec.ts`（Playwright） | **`E2E_TEST_ENV=true` + テスト専用Supabase環境変数が必須**。設定がないと`playwright.config.ts`がエラーで止まる（安全ガード）。本番系DBに向けて実行しない |
| DB | `supabase/tests/security_hardening.test.sql` | RLS・セキュリティ設定 | ローカルSupabase起動済み |

## 変更種別ごとの目安

- ロジック（`src/app/actions/*`, `src/utils/*`）変更 → `npm run test:unit` + `npm run typecheck`
- UIコンポーネント（`src/components/ui/*`）変更 → `npm run test:ui` + 対応するStorybookストーリー更新
- 権限・RLS（`permissions.ts` / `supabase/migrations/*`）変更 → ローカルSupabaseでマイグレーション適用
  → DBテスト → 関連する `npm run test:unit` → 必要ならE2E（ユーザーに実行許可を確認してから）
- 常時: `npm run lint` と `npm run typecheck`

## 注意

- E2Eは`E2E_TEST_ENV`を要求する安全設計。前提が整っていない環境で無理に実行しない。
- 実行していないテスト・コマンドについて「確認済み」「テスト済み」と報告しない。

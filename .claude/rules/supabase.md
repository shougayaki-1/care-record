# Supabase / DB ルール

- マイグレーションは新規ファイル追加のみ。適用済みファイルと `supabase/migrations/old/`
  （歴史的アーカイブ）の編集禁止。
- RLSポリシーを変更したら、`src/utils/permissions.ts` 側の対応する定義と突き合わせ、
  差分がないことを変更内容に明記する（逆方向、permissions.ts変更時も同様）。
- 新規テーブルには RLS 有効化・組織スコープ（`organization_id`等）・監査対象かどうかの
  判断を必ず含める。
- 新規テーブルごとに `anon` / `authenticated` / `service_role` の必要権限を確認し、
  デフォルト権限に依存せず明示的な `GRANT` / `REVOKE` を同じマイグレーションへ記載する。
- 関数を追加したら `GRANT EXECUTE ... TO authenticated` の要否を確認する
  （過去に付与漏れバグあり: `20260701000004_fix_function_grants.sql`）。
- 物理DELETEを書かない。削除は論理削除 + 保持期間purge（`src/utils/supabase/retention.ts`）の
  仕組みに従う。
- スキーマ変更後は `supabase/tests/security_hardening.test.sql` の更新要否を確認する。
- ローカル検証: `supabase start` → `supabase migration up` 相当の適用 → 対象テスト実行。

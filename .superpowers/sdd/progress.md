# SDD Progress Ledger — Plan: RLS × 柔軟ロール 権限整合

## Tasks
- [ ] Task 1: permission_alignment.sql の内容検証
- [ ] Task 2: permission_alignment.sql を Supabase DB に適用
- [ ] Task 3: report 系 RLS ポリシーの修正（新規マイグレーション作成）
- [ ] Task 4: 本番 DB への適用確認

## Log
Base commit: dcb7b11
Task 1: complete (no code changes — verification only; Minor: can_access_client GRANT missing, will add in Task 3 migration)
Task 2: complete (local DB push applied — all new policies confirmed in local DB dump)
Task 3: complete (commits dcb7b11..a54d73f, review clean — Minor: GRANT comment misleading but idempotent/harmless)
Task 4: complete (supabase migration list confirms 20260701000002 + 20260701000003 applied to remote)
Fix: GRANT EXECUTE for get_member_record_action_scope/view_scope added (commit 54882a0) — final review Important finding resolved

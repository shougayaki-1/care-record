# RLS × 柔軟ロール 権限整合プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `permission_alignment.sql` の DB 適用と、残存する `report` 系 RLS ポリシーの修正により、RLS・Server Action・UI が同一の `RolePermissions` モデルを共有した状態を実現する。

**Architecture:**
- DB 側：`private.*` helper 関数（既に init.sql で定義）をポリシーが直接参照する形に統一。`is_org_admin` は `role = 'owner'` チェックのみに限定し、管理操作ごとの権限判定は `private.has_management_permission` / `private.get_member_record_action_scope` に委ねる。
- Server Action 側：`supabaseAdmin`（RLS バイパス）経由の操作はすでに正しく認可済み。DB 側 RLS は防御の多層化として機能する。

**Tech Stack:** Supabase (PostgreSQL 15+), Next.js 15 Server Actions, TypeScript

## Global Constraints

- マイグレーションファイルは `supabase/migrations/` に `YYYYMMDDHHMMSS_<name>.sql` 形式で追加。
- 既存マイグレーションファイルを編集してはならない。新規ファイルを追加する。
- RLS の SECURITY DEFINER 関数はすべて `SET "search_path" TO ''` を設定して schema injection を防ぐ。
- すべての DROP POLICY は `IF EXISTS` 付きで記述し、二重適用時の無害化を確保する。
- `supabase db push` / `supabase migration up` でローカル DB に適用してから本番に反映する。

---

## 現状整理（着手前に確認）

### すでに解決済みの問題

| 問題 | 修正場所 | 状態 |
|---|---|---|
| `getShiftSegments` IDOR | `src/app/actions/shiftSegments.ts:39` | ✅ コード内で `organization_id` 検証済み |
| `getReportsByShift` IDOR | `src/app/actions/reports.ts:394` | ✅ 同上 |
| AppLayout ナビ個別権限 | `src/components/layout/AppLayout.tsx:480-492` | ✅ 各アイテムごとに `checkManagementPermission` 呼び出し済み |
| `/app/settings` ルートガード | `src/components/layout/AppLayout.tsx:534-541` | ✅ `settingsAccessDenied` カスタムガード実装済み |
| `is_org_admin` 柔軟ロール乖離 | `supabase/migrations/20260701000002_permission_alignment.sql` | ✅ マイグレーション作成済み（DB 未適用） |
| `can_access_client` 不整合 | 同上 | ✅ 同上 |
| `internal_work_records` SELECT RLS | 同上 | ✅ 同上 |
| shifts / clients / staffs / assignments / orgs ポリシー | 同上 | ✅ 同上 |

### 残課題

| 問題 | 対象テーブル | リスクレベル |
|---|---|---|
| `permission_alignment.sql` が DB に未適用 | 全テーブル | 高（本番 DB で旧ポリシーが動作中） |
| `reports` UPDATE ポリシーが `is_org_admin` 依存 | `reports` | 低（Server Action が supabaseAdmin 経由のため直接影響なし） |
| `reports` DELETE ポリシーが `is_org_admin` 依存 | `reports` | 低 |
| `report_values` ALL ポリシーが `is_org_admin` 依存 | `report_values` | 低 |
| `report_images` DELETE ポリシーが `is_org_admin` 依存 | `report_images` | 低 |

---

## Task 1: `permission_alignment.sql` の内容検証

**Files:**
- Read: `supabase/migrations/20260701000002_permission_alignment.sql`

検証ポイント（全て確認済みならチェック）：

- [ ] `private.has_management_permission` が owner と role JSONB の `management.*` 両方をカバーする
- [ ] `private.can_access_client` が `records.view = 'all'` のユーザーと assignment ユーザー双方をカバーする
- [ ] `private.get_member_internal_work_scope` が `'all'` / `'assigned'` / `'none'` を正しく返す
- [ ] `Internal work visible by flexible role` ポリシーが古い `Internal work visible to org members` を DROP する
- [ ] shifts 系ポリシーが `get_member_shift_action_scope` を使用する
- [ ] clients / staffs / assignments / form_templates / organization_members / invitations / organizations の各ポリシーが `has_management_permission` を使用する
- [ ] GRANT 文が `private.*` 関数に `authenticated` ロールへの EXECUTE を付与している

**Step 1.1: `permission_alignment.sql` の確認**

```bash
cat supabase/migrations/20260701000002_permission_alignment.sql
```

期待：上記チェック項目がすべて含まれていること

- [ ] **Step 1.2: `is_org_admin` が owner-only に戻っていることを確認**

`permission_alignment.sql` 内の `is_org_admin` 定義が以下と一致すること：

```sql
CREATE OR REPLACE FUNCTION "public"."is_org_admin"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _org_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  );
$$;
```

- [ ] **Step 1.3: `can_access_client` が `management.reports` もカバーすることを確認**

`can_access_client` 内に `has_management_permission(..., 'reports')` 呼び出しがあること

---

## Task 2: `permission_alignment.sql` を Supabase DB に適用

**Files:**
- Execute: `supabase db push` or `supabase migration up`

- [ ] **Step 2.1: ローカル DB でマイグレーションを適用**

```bash
supabase db push --local
# または
supabase migration up
```

期待：`20260701000002_permission_alignment` が適用される

- [ ] **Step 2.2: ポリシー変更を確認（ローカル DB）**

```sql
-- Supabase Studio の SQL Editor または psql で実行
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN (
  'internal_work_records', 'shifts', 'clients', 'staffs',
  'organization_members', 'invitations', 'assignments',
  'organizations', 'shift_staffs', 'shift_patterns'
)
ORDER BY tablename, policyname;
```

確認内容：
- `Internal work visible to org members` が存在しない（DROP 済み）
- `Internal work visible by flexible role` が存在する
- `Admins can insert shifts` が存在しない（DROP 済み）
- `Shift creators insert shifts` が存在する

- [ ] **Step 2.3: `is_org_admin` 変更を確認**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'is_org_admin'
  AND pronamespace = 'public'::regnamespace;
```

期待：`records` キーへの参照がなく、`role = 'owner'` チェックのみであること

- [ ] **Step 2.4: Commit**

```bash
# マイグレーション適用後、問題なければ
git add supabase/migrations/20260701000002_permission_alignment.sql
git commit -m "feat: apply permission_alignment migration to align RLS with flexible roles"
```

---

## Task 3: report 系 RLS ポリシーの修正（防御の多層化）

**Background:** Server Actions がすべて `supabaseAdmin` 経由で `report_images` / `reports` / `report_values` を操作するため、現在の RLS 誤りはアプリ動作に直接影響しない。ただし、将来の直接クエリ経路やデバッグ用クエリの権限漏洩を防ぐため修正する。

**Files:**
- Create: `supabase/migrations/20260701000003_fix_report_policies.sql`

- [ ] **Step 3.1: 新規マイグレーションファイルを作成**

```sql
-- supabase/migrations/20260701000003_fix_report_policies.sql
-- Fix: report / report_values / report_images の UPDATE/DELETE/ALL ポリシーを
--      is_org_admin（owner-only）から get_member_record_action_scope ベースに置換する

-- ─── reports UPDATE ────────────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.edit = 'all' OR owner
DROP POLICY IF EXISTS "Update reports" ON "public"."reports";
CREATE POLICY "Update reports" ON "public"."reports"
  FOR UPDATE
  USING (
    helper_id = auth.uid()
    OR private.get_member_record_action_scope(
         (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
         auth.uid(),
         'edit'
       ) = 'all'
  )
  WITH CHECK (
    helper_id = auth.uid()
    OR private.get_member_record_action_scope(
         (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
         auth.uid(),
         'edit'
       ) = 'all'
  );

-- ─── reports DELETE ────────────────────────────────────────────────────────────
-- Before: is_org_admin のみ
-- After:  records.delete = 'all' OR owner
DROP POLICY IF EXISTS "Delete reports" ON "public"."reports";
CREATE POLICY "Delete reports" ON "public"."reports"
  FOR DELETE
  USING (
    private.get_member_record_action_scope(
      (SELECT organization_id FROM public.clients c WHERE c.id = reports.client_id),
      auth.uid(),
      'delete'
    ) = 'all'
  );

-- ─── report_values ALL ─────────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.edit = 'all'
DROP POLICY IF EXISTS "Manage report values" ON "public"."report_values";
CREATE POLICY "Manage report values" ON "public"."report_values"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_values.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'edit') = 'all'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_values.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'edit') = 'all'
        )
    )
  );

-- ─── report_images DELETE ──────────────────────────────────────────────────────
-- Before: helper_id = user OR is_org_admin
-- After:  helper_id = user OR records.delete = 'all'
DROP POLICY IF EXISTS "Delete report images" ON "public"."report_images";
CREATE POLICY "Delete report images" ON "public"."report_images"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE r.id = report_images.report_id
        AND (
          r.helper_id = auth.uid()
          OR private.get_member_record_action_scope(c.organization_id, auth.uid(), 'delete') = 'all'
        )
    )
  );
```

- [ ] **Step 3.2: ローカル DB に適用**

```bash
supabase db push --local
# または
supabase migration up
```

期待：`20260701000003_fix_report_policies` が適用される

- [ ] **Step 3.3: ポリシーを確認**

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('reports', 'report_values', 'report_images')
ORDER BY tablename, policyname;
```

確認内容：
- `Update reports` が `get_member_record_action_scope` を使用する
- `Delete reports` が `get_member_record_action_scope` を使用する
- 古い `is_org_admin` への参照がこれらのポリシーに残っていない

- [ ] **Step 3.4: Commit**

```bash
git add supabase/migrations/20260701000003_fix_report_policies.sql
git commit -m "fix: replace is_org_admin in report/report_values/report_images RLS with flexible role scope checks"
```

---

## Task 4: 本番 DB への適用確認

- [ ] **Step 4.1: Supabase Dashboard でマイグレーション適用状況を確認**

```
Supabase Dashboard → Database → Migrations
```

`20260701000002_permission_alignment` と `20260701000003_fix_report_policies` が Applied であること

- [ ] **Step 4.2: 本番 DB にプッシュ（CI/CD 経由または手動）**

```bash
# Supabase linked project がある場合
supabase db push
```

- [ ] **Step 4.3: 動作確認チェックリスト（手動または Supabase Studio）**

```sql
-- owner でないがスタッフロールを持つユーザーでテスト
-- (management.clients = true のロールを持つユーザーで実行)

-- 1. クライアント一覧が取得できること（Manage clients ポリシー）
SELECT count(*) FROM clients WHERE organization_id = '<your-org-id>';

-- 2. 内勤記録が自分のものだけ見えること（internalWork.view = 'assigned' のユーザー）
SELECT count(*) FROM internal_work_records WHERE organization_id = '<your-org-id>';

-- 3. シフトが作成できること（shifts.create = 'all' のユーザー）
-- → Shift creators insert shifts ポリシーが機能すること

-- 4. owner でないユーザーがシフトを作れないこと（shifts.create = 'none' のユーザー）
-- → 403/RLS エラーになること
```

---

## 付録：is_org_admin が残存しているポリシー一覧（意図的に放置）

以下のポリシーは `is_org_admin`（= owner-only）に依存しているが、
Server Action がすべて `supabaseAdmin` 経由で実行するため実害なし。
将来的に直接クエリが必要になった場合に Task 3 と同様のパターンで修正する。

| テーブル | ポリシー名 | 用途 |
|---|---|---|
| `report_images` | Insert report images | INSERT - helper_id チェック + owner |
| `reports` | Insert reports | INSERT（save_report_atomic が SECURITY DEFINER で実行） |

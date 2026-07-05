# 事業所マスタと交通費単価の事業所別管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「事業所」マスタを新設し、利用者・スタッフをそれぞれ所属事業所に紐付けたうえで、提供記録の交通費計算に使う単価(円/km)を組織単位から事業所単位（担当スタッフの所属事業所）に移す。

**Architecture:** 新規 `offices` テーブル（`organization_id` スコープ、`name` + `travel_cost_rate_yen_per_km` + `archived_at` の論理削除）を追加し、`clients.office_id` / `staffs.office_id` の外部キーで紐付ける。既存の距離マスタ（`assignments.round_trip_distance_km`）と提供記録での距離表示・上書きの仕組みは変更しない。変わるのは交通費単価の参照元のみ：提供記録作成時に「担当スタッフの所属事業所」の単価を使う。

**Tech Stack:** Next.js 16 App Router / Supabase (`@supabase/ssr`, RLS) / TypeScript / MUI v7 / Vitest

## Global Constraints

- マイグレーションは新規ファイル追加のみ。既存ファイル・`supabase/migrations/old/` は編集しない。
- 物理DELETEを書かない。`offices` の削除は `archived_at` による論理削除のみ。
- Server Action で生の `error.message` を外部に投げない場合は `sanitizeDbError` 経由にする（既存 `staffRoles.ts` は素の `new Error()` を投げているため、新規 `offices.ts` は `staffs.ts` パターン（`sanitizeDbError`）に合わせる）。
- 新規UIは可能な限り `src/components/ui` のセマンティックコンポーネントを使う。色はテーマトークンのみ。
- `permissions.ts` と RLS ポリシーの整合を明示的に確認する（本プランでは書き込みは `assertOrgPermission(orgId, 'organization')` を流用し、RLSは既存 `is_org_member()` 読み取りポリシーのみ追加するため、既存の権限モデルに変更はない）。
- 変更後は最低限 `npm run typecheck` と `npm run lint` を実行する。`src/app/actions/*` を変更するため `npm run test:unit` も実行する。`supabase/migrations/*` を変更するためローカルSupabaseでマイグレーション適用と `supabase/tests/security_hardening.test.sql` の確認も行う。

---

### Task 1: `offices` テーブルのマイグレーション

**Files:**
- Create: `supabase/migrations/20260705000000_offices.sql`

**Interfaces:**
- Produces: テーブル `public.offices(id uuid, organization_id uuid, name text, travel_cost_rate_yen_per_km numeric(8,2), archived_at timestamptz, created_at timestamptz, updated_at timestamptz)`。カラム `public.clients.office_id uuid`、`public.staffs.office_id uuid`（共に `offices(id)` を参照、`ON DELETE RESTRICT`）。RLSポリシー `"Org members read offices"`（SELECT、`is_org_member(organization_id) AND archived_at IS NULL`）。

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260705000000_offices.sql

CREATE TABLE IF NOT EXISTS "public"."offices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "travel_cost_rate_yen_per_km" numeric(8,2) DEFAULT 20 NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "offices_travel_cost_rate_yen_per_km_check"
        CHECK ((("travel_cost_rate_yen_per_km" >= (0)::numeric) AND ("travel_cost_rate_yen_per_km" <= (10000)::numeric)))
);

ALTER TABLE "public"."offices" OWNER TO "postgres";

ALTER TABLE ONLY "public"."offices"
    ADD CONSTRAINT "offices_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."offices"
    ADD CONSTRAINT "offices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE "public"."offices" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read offices" ON "public"."offices"
    FOR SELECT TO "authenticated"
    USING (("private"."is_org_member"("organization_id") AND ("archived_at" IS NULL)));

GRANT SELECT ON TABLE "public"."offices" TO "authenticated";
GRANT ALL ON TABLE "public"."offices" TO "service_role";

-- 利用者・スタッフの所属事業所（タグ）。権限境界ではなく交通費単価の参照先として使う。
ALTER TABLE "public"."clients" ADD COLUMN "office_id" "uuid";
ALTER TABLE "public"."staffs" ADD COLUMN "office_id" "uuid";

ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "staffs_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE RESTRICT;

-- バックフィル: 各organizationに現行の交通費単価を引き継いだデフォルト事業所を1件作成し、
-- 既存の全client/staffをそこに割り当てる。
DO $$
DECLARE
    org RECORD;
    new_office_id uuid;
BEGIN
    FOR org IN SELECT "id", "name", "travel_cost_rate_yen_per_km" FROM "public"."organizations" WHERE "deleted_at" IS NULL LOOP
        INSERT INTO "public"."offices" ("organization_id", "name", "travel_cost_rate_yen_per_km")
        VALUES (org."id", org."name", org."travel_cost_rate_yen_per_km")
        RETURNING "id" INTO new_office_id;

        UPDATE "public"."clients" SET "office_id" = new_office_id
        WHERE "organization_id" = org."id" AND "office_id" IS NULL;

        UPDATE "public"."staffs" SET "office_id" = new_office_id
        WHERE "organization_id" = org."id" AND "office_id" IS NULL;
    END LOOP;
END $$;
```

- [ ] **Step 2: ローカルSupabaseに適用する**

Run: `supabase migration up`
Expected: マイグレーションが `Applying migration 20260705000000_offices.sql...` のように出力され、エラーなく完了する。

- [ ] **Step 3: バックフィルを確認する**

Run: `supabase db execute --sql "select count(*) from offices; select count(*) from staffs where office_id is null; select count(*) from clients where office_id is null;"` （ローカルSupabaseに既存の組織・スタッフ・利用者データがある場合）
Expected: `offices` の件数が organizations の件数と一致し、`office_id is null` の件数がどちらも0。

- [ ] **Step 4: `supabase/tests/security_hardening.test.sql` の更新要否を確認する**

`supabase/tests/security_hardening.test.sql` を読み、`offices` テーブルの読み取りRLS（組織外ユーザーから見えないこと）を検証するテストケースの追加が既存パターンに沿って必要か判断する。既存ファイルの他テーブルの検証パターン（例: `staff_roles` があれば流用）に倣って同等のケースを追加する。

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20260705000000_offices.sql supabase/tests/security_hardening.test.sql
git commit -m "feat: add offices table with per-office travel cost rate and client/staff office_id"
```

---

### Task 2: `offices` Server Actions

**Files:**
- Create: `src/app/actions/offices.ts`
- Test: `src/app/actions/offices.test.ts`

**Interfaces:**
- Consumes: `assertOrgRole(orgId)`, `assertOrgPermission(orgId, 'organization')`, `supabaseAdmin` from `@/utils/supabase/auth`; `sanitizeDbError` from `@/utils/errors`; `recordAuditEvent` from `@/utils/supabase/audit`.
- Produces:
  - `export type Office = { id: string; organization_id: string; name: string; travel_cost_rate_yen_per_km: number; archived_at: string | null; created_at: string }`
  - `getOffices(orgId: string): Promise<Office[]>`
  - `createOffice(orgId: string, name: string, rateYenPerKm: number): Promise<Office>`
  - `updateOffice(orgId: string, officeId: string, patch: { name?: string; travel_cost_rate_yen_per_km?: number }): Promise<void>`
  - `archiveOffice(orgId: string, officeId: string): Promise<void>`

既存の類似実装 `src/app/actions/staffRoles.ts`（読み取り/書き込み権限チェックの分け方）と `src/app/actions/staffs.ts`（`sanitizeDbError` の使い方）を参考にする。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/app/actions/offices.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAssertOrgRole = vi.fn();
const mockAssertOrgPermission = vi.fn();
const mockFrom = vi.fn();
const mockRecordAuditEvent = vi.fn();

vi.mock('@/utils/supabase/auth', () => ({
  assertOrgRole: (...args: unknown[]) => mockAssertOrgRole(...args),
  assertOrgPermission: (...args: unknown[]) => mockAssertOrgPermission(...args),
  supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}));
vi.mock('@/utils/supabase/audit', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

import { getOffices, createOffice, updateOffice, archiveOffice } from './offices';

describe('offices actions', () => {
  const orgId = 'org-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertOrgRole.mockResolvedValue({ userId: 'user-1' });
    mockAssertOrgPermission.mockResolvedValue({ userId: 'user-1' });
  });

  it('getOffices: アーカイブ済みを除外して一覧取得する', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'o1', organization_id: orgId, name: '本社', travel_cost_rate_yen_per_km: 20, archived_at: null, created_at: '2026-01-01' }],
      error: null,
    });
    const is = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });

    const result = await getOffices(orgId);

    expect(mockAssertOrgRole).toHaveBeenCalledWith(orgId);
    expect(mockFrom).toHaveBeenCalledWith('offices');
    expect(is).toHaveBeenCalledWith('archived_at', null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('本社');
  });

  it('createOffice: 単価が範囲外だとエラーになる', async () => {
    await expect(createOffice(orgId, '第二事業所', -1)).rejects.toThrow('交通費単価は0〜10000円で入力してください');
    await expect(createOffice(orgId, '第二事業所', 10001)).rejects.toThrow('交通費単価は0〜10000円で入力してください');
  });

  it('createOffice: 正常系で作成し監査ログを記録する', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'o2', organization_id: orgId, name: '第二事業所', travel_cost_rate_yen_per_km: 25, archived_at: null, created_at: '2026-01-02' },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    mockFrom.mockReturnValue({ insert });

    const result = await createOffice(orgId, '第二事業所', 25);

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(insert).toHaveBeenCalledWith({ organization_id: orgId, name: '第二事業所', travel_cost_rate_yen_per_km: 25 });
    expect(result.name).toBe('第二事業所');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'office.create' }));
  });

  it('updateOffice: 権限チェックのうえ更新する', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    mockFrom.mockReturnValue({ update });

    await updateOffice(orgId, 'o1', { name: '本社(改称)', travel_cost_rate_yen_per_km: 30 });

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(update).toHaveBeenCalledWith({ name: '本社(改称)', travel_cost_rate_yen_per_km: 30 });
  });

  it('archiveOffice: archived_atを設定する', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const update = vi.fn().mockReturnValue({ eq: eq1 });
    mockFrom.mockReturnValue({ update });

    await archiveOffice(orgId, 'o1');

    expect(mockAssertOrgPermission).toHaveBeenCalledWith(orgId, 'organization');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm run test:unit -- src/app/actions/offices.test.ts`
Expected: FAIL（`./offices` module not found）

- [ ] **Step 3: `offices.ts` を実装する**

```typescript
// src/app/actions/offices.ts
'use server';

import { sanitizeDbError } from '@/utils/errors';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { assertOrgRole, assertOrgPermission, supabaseAdmin } from '@/utils/supabase/auth';

export type Office = {
  id: string;
  organization_id: string;
  name: string;
  travel_cost_rate_yen_per_km: number;
  archived_at: string | null;
  created_at: string;
};

function validateRate(rateYenPerKm: number): number {
  const rate = Number(rateYenPerKm);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000) {
    throw new Error('交通費単価は0〜10000円で入力してください');
  }
  return rate;
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 100) throw new Error('事業所名は1〜100文字で入力してください');
  return normalized;
}

export async function getOffices(orgId: string): Promise<Office[]> {
  await assertOrgRole(orgId);
  const { data, error } = await supabaseAdmin
    .from('offices')
    .select('*')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw sanitizeDbError(error, 'action.offices');
  return (data ?? []) as Office[];
}

export async function createOffice(orgId: string, name: string, rateYenPerKm: number): Promise<Office> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const normalizedName = validateName(name);
  const rate = validateRate(rateYenPerKm);
  const { data, error } = await supabaseAdmin
    .from('offices')
    .insert({ organization_id: orgId, name: normalizedName, travel_cost_rate_yen_per_km: rate })
    .select('*')
    .single();
  if (error || !data) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.create', resourceType: 'office', resourceId: data.id });
  return data as Office;
}

export async function updateOffice(
  orgId: string,
  officeId: string,
  patch: { name?: string; travel_cost_rate_yen_per_km?: number },
): Promise<void> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const normalizedPatch: { name?: string; travel_cost_rate_yen_per_km?: number } = {};
  if (patch.name !== undefined) normalizedPatch.name = validateName(patch.name);
  if (patch.travel_cost_rate_yen_per_km !== undefined) normalizedPatch.travel_cost_rate_yen_per_km = validateRate(patch.travel_cost_rate_yen_per_km);

  const { error } = await supabaseAdmin
    .from('offices')
    .update(normalizedPatch)
    .eq('id', officeId)
    .eq('organization_id', orgId);
  if (error) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.update', resourceType: 'office', resourceId: officeId });
}

export async function archiveOffice(orgId: string, officeId: string): Promise<void> {
  const { userId } = await assertOrgPermission(orgId, 'organization');
  const { error } = await supabaseAdmin
    .from('offices')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', officeId)
    .eq('organization_id', orgId);
  if (error) throw sanitizeDbError(error, 'action.offices');
  await recordAuditEvent({ organizationId: orgId, actorId: userId, action: 'office.archive', resourceType: 'office', resourceId: officeId });
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npm run test:unit -- src/app/actions/offices.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/app/actions/offices.ts src/app/actions/offices.test.ts
git commit -m "feat: add offices CRUD server actions"
```

---

### Task 3: 設定画面に事業所管理パネルを追加し、交通費設定セクションを置き換える

**Files:**
- Create: `src/components/settings/OfficeManagementPanel.tsx`
- Create: `src/components/settings/OfficeManagementPanel.stories.tsx`
- Modify: `src/app/actions/settingsSections.ts`
- Modify: `src/app/actions/organization.ts:32-47`（`updateTravelCostSettings` を削除）
- Modify: `src/app/app/settings/page.tsx`

**Interfaces:**
- Consumes: `getOffices`, `createOffice`, `updateOffice`, `archiveOffice`, `type Office` from `@/app/actions/offices`（Task 2）
- Produces: `export default function OfficeManagementPanel({ orgId, initialOffices }: { orgId: string; initialOffices?: Office[] })`

- [ ] **Step 1: `settingsSections.ts` に事業所一覧を追加する**

`src/app/actions/settingsSections.ts` を以下のように変更する（`offices` を戻り値に追加）:

```typescript
'use server';
import { supabaseAdmin, assertOrgRole } from '@/utils/supabase/auth';
import type { LaborPremiumType } from '@/utils/laborPremium';
import type { ServiceType } from '@/app/actions/serviceTypes';
import type { StaffRole } from '@/app/actions/staffRoles';
import type { Office } from '@/app/actions/offices';

export async function getSettingsSectionsData(orgId: string): Promise<{
  laborPremiumTypes: LaborPremiumType[];
  serviceTypes: ServiceType[];
  staffRoles: StaffRole[];
  offices: Office[];
}> {
  await assertOrgRole(orgId);

  const [laborPremiumResult, serviceTypesResult, staffRolesResult, officesResult] = await Promise.all([
    supabaseAdmin
      .from('labor_premium_types')
      .select('*')
      .eq('organization_id', orgId)
      .order('display_order'),
    supabaseAdmin
      .from('service_types')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabaseAdmin
      .from('staff_roles')
      .select('*')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabaseAdmin
      .from('offices')
      .select('*')
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
  ]);

  if (laborPremiumResult.error) throw new Error('労働時間ルールを取得できませんでした');
  if (serviceTypesResult.error) throw new Error('サービス種別を取得できませんでした');
  if (staffRolesResult.error) throw new Error('スタッフ役割を取得できませんでした');
  if (officesResult.error) throw new Error('事業所を取得できませんでした');

  return {
    laborPremiumTypes: (laborPremiumResult.data ?? []) as LaborPremiumType[],
    serviceTypes: (serviceTypesResult.data ?? []) as ServiceType[],
    staffRoles: (staffRolesResult.data ?? []) as StaffRole[],
    offices: (officesResult.data ?? []) as Office[],
  };
}
```

- [ ] **Step 2: `OfficeManagementPanel.tsx` を実装する**（`src/components/settings/StaffRoleSettings.tsx` の構成に倣う）

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Box, Stack, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@/components/ui/mui';
import { AppButton, AppDialog, AppTextField, NumberField } from '@/components/ui';
import {
  getOffices, createOffice, updateOffice, archiveOffice,
  type Office,
} from '@/app/actions/offices';

export default function OfficeManagementPanel({
  orgId,
  initialOffices,
}: {
  orgId: string;
  initialOffices?: Office[];
}) {
  const [rows, setRows] = useState<Office[]>(initialOffices ?? []);
  const [loading, setLoading] = useState(initialOffices === undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Office | null>(null);
  const [editName, setEditName] = useState('');
  const [editRate, setEditRate] = useState('20');
  const [editOpen, setEditOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addRate, setAddRate] = useState('20');

  const [archiveTarget, setArchiveTarget] = useState<Office | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getOffices(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialOffices !== undefined) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleEditOpen = (row: Office) => {
    setEditTarget(row);
    setEditName(row.name);
    setEditRate(String(row.travel_cost_rate_yen_per_km));
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget || !editName.trim()) return;
    setSaving(true);
    try {
      await updateOffice(orgId, editTarget.id, { name: editName.trim(), travel_cost_rate_yen_per_km: Number(editRate) });
      setEditOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSave = async () => {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      await createOffice(orgId, addName.trim(), Number(addRate));
      setAddOpen(false);
      setAddName('');
      setAddRate('20');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await archiveOffice(orgId, archiveTarget.id);
      setArchiveOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アーカイブに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Box py={3} textAlign="center"><CircularProgress size={24} /></Box>;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Table size="small" sx={{ minWidth: 360 }}>
        <TableHead>
          <TableRow>
            <TableCell>事業所名</TableCell>
            <TableCell>交通費単価(円/km)</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={3} align="center">事業所が登録されていません</TableCell></TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell sx={{ minWidth: 140 }}>{row.name}</TableCell>
                <TableCell>{row.travel_cost_rate_yen_per_km.toLocaleString()}円/km</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1}>
                    <AppButton variant="text" intent="secondary" size="small" onClick={() => handleEditOpen(row)}>編集</AppButton>
                    <AppButton variant="text" intent="danger" size="small" onClick={() => { setArchiveTarget(row); setArchiveOpen(true); }}>アーカイブ</AppButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Box mt={2}>
        <AppButton variant="outlined" intent="secondary" size="small" onClick={() => { setAddName(''); setAddRate('20'); setAddOpen(true); }}>
          事業所を追加
        </AppButton>
      </Box>

      <AppDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        maxWidth="xs"
        title="事業所を編集"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setEditOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleEditSave} disabled={saving || !editName.trim()}>
              {saving ? '保存中...' : '保存'}
            </AppButton>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <AppTextField label="事業所名" value={editName} onChange={(e) => setEditName(e.target.value)} fullWidth size="small" autoFocus />
          <NumberField
            label="1kmあたり単価"
            value={editRate}
            onChange={(e) => setEditRate(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: '1', min: 0 } }}
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        maxWidth="xs"
        title="事業所を追加"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setAddOpen(false)}>キャンセル</AppButton>
            <AppButton onClick={handleAddSave} disabled={saving || !addName.trim()}>
              {saving ? '追加中...' : '追加'}
            </AppButton>
          </>
        )}
      >
        <Stack spacing={2} mt={1}>
          <AppTextField label="事業所名" value={addName} onChange={(e) => setAddName(e.target.value)} fullWidth size="small" autoFocus />
          <NumberField
            label="1kmあたり単価"
            value={addRate}
            onChange={(e) => setAddRate(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: '1', min: 0 } }}
          />
        </Stack>
      </AppDialog>

      <AppDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        maxWidth="xs"
        title="事業所をアーカイブ"
        actions={(
          <>
            <AppButton variant="text" intent="secondary" onClick={() => setArchiveOpen(false)}>キャンセル</AppButton>
            <AppButton intent="danger" onClick={handleArchiveConfirm} disabled={saving}>
              {saving ? '処理中...' : 'アーカイブ'}
            </AppButton>
          </>
        )}
      >
        <Box mt={1}>「{archiveTarget?.name}」をアーカイブしますか？所属中のスタッフ・利用者がいる場合は先に所属を変更してください。</Box>
      </AppDialog>
    </Box>
  );
}
```

- [ ] **Step 3: Storybookストーリーを追加する**（`StaffRoleSettings` に対応するストーリーがあれば同じ形式に倣う。無ければ最小構成で作成）

```tsx
// src/components/settings/OfficeManagementPanel.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import OfficeManagementPanel from './OfficeManagementPanel';

const meta: Meta<typeof OfficeManagementPanel> = {
  title: 'Settings/OfficeManagementPanel',
  component: OfficeManagementPanel,
};
export default meta;

type Story = StoryObj<typeof OfficeManagementPanel>;

export const Default: Story = {
  args: {
    orgId: 'org-1',
    initialOffices: [
      { id: 'o1', organization_id: 'org-1', name: '本社', travel_cost_rate_yen_per_km: 20, archived_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'o2', organization_id: 'org-1', name: '第二事業所', travel_cost_rate_yen_per_km: 25, archived_at: null, created_at: '2026-01-02T00:00:00Z' },
    ],
  },
};

export const Empty: Story = {
  args: { orgId: 'org-1', initialOffices: [] },
};
```

- [ ] **Step 4: `settings/page.tsx` を変更する**

1. import追加: `import OfficeManagementPanel from '@/components/settings/OfficeManagementPanel';` と `import type { Office } from '@/app/actions/offices';`
2. `import { deleteOrganization, disconnectGoogleCalendar, leaveOrganization, updateOrganizationDriveFolder, updateOrganizationName, updateTravelCostSettings } from '@/app/actions/organization';` から `updateTravelCostSettings` を削除
3. `settingsSectionsData` の型に `offices: Office[];` を追加
4. 未使用になる `travelCostRate` state（`const [travelCostRate, setTravelCostRate] = useState('20');`）と、`fetchOrgDetails` 内の `setTravelCostRate(String(data.travel_cost_rate_yen_per_km ?? 20));` の行、および `handleSaveTravelCost` 関数を削除
5. `fetchOrgDetails` の `select` から `travel_cost_rate_yen_per_km` を削除（`select('name, google_folder_id, google_calendar_id')`）
6. tabIndex 0 内の「交通費設定」の `Box` セクション全体（`NumberField` と保存ボタンを含む部分）を削除
7. tabIndex 2 内、`StaffRoleSettings` の直後に以下を追加:

```tsx
                            {/* 事業所 */}
                            {canEditOrganization && (
                                <Box sx={{ p: { xs: 2, sm: 4 }, borderRadius: 1 }}>
                                    <Typography variant="h6" fontWeight="bold" gutterBottom>事業所</Typography>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        利用者・スタッフの所属先と、事業所ごとの交通費単価（円/km）を管理します。
                                        提供記録の交通費は担当スタッフの所属事業所の単価で算出されます。
                                    </Typography>
                                    <OfficeManagementPanel orgId={currentOrg.id} initialOffices={settingsSectionsData?.offices} />
                                </Box>
                            )}
```

- [ ] **Step 5: `organization.ts` から `updateTravelCostSettings` を削除する**

`src/app/actions/organization.ts:32-47` の `updateTravelCostSettings` 関数を削除する（利用箇所がなくなるため）。

- [ ] **Step 6: 動作確認**

Run: `npm run dev` を起動し、設定画面の「勤務・帳票ルール」タブに事業所一覧の管理パネルが表示され、追加・編集・アーカイブができること、基本設定タブから交通費設定セクションが消えていることをブラウザで確認する。

- [ ] **Step 7: typecheck / lint**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/components/settings/OfficeManagementPanel.tsx src/components/settings/OfficeManagementPanel.stories.tsx src/app/actions/settingsSections.ts src/app/actions/organization.ts src/app/app/settings/page.tsx
git commit -m "feat: replace org-wide travel cost setting with per-office management panel"
```

---

### Task 4: スタッフに所属事業所を設定できるようにする

**Files:**
- Modify: `src/app/actions/staffs.ts`
- Modify: `src/app/app/staff/page.tsx`

**Interfaces:**
- Consumes: `getOffices`, `type Office` from `@/app/actions/offices`（Task 2）
- Produces: `saveStaff` の `values` に `officeId: string | null` を追加（既存呼び出し元との互換のため optional にはせず、UIから常に渡す）

- [ ] **Step 1: `staffs.ts` の `saveStaff` に `office_id` を追加する**

`src/app/actions/staffs.ts:73-107` の `saveStaff` を変更する:

```typescript
export async function saveStaff(
  organizationId: string,
  values: {
    staffId?: string | null;
    name: string;
    positions: string[];
    employmentType: string;
    workStyle: string;
    linkedUserId?: string | null;
    officeId?: string | null;
  },
) {
  const { userId } = await assertOrgPermission(organizationId, 'staffs');
  const normalized = await normalizeStaffInput(organizationId, values.name, values.positions, values.employmentType, values.workStyle);
  const linkedUserId = values.linkedUserId || null;
  await validateLinkedUser(organizationId, linkedUserId, values.staffId);
  const officeId = values.officeId || null;
  if (officeId) {
    const { data: office } = await supabaseAdmin.from('offices').select('id').eq('id', officeId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
    if (!office) throw new Error('選択された事業所が見つかりません');
  }

  let staffId = values.staffId || null;
  if (staffId) {
    await assertStaffOrg(staffId, organizationId);
    const { error } = await supabaseAdmin.from('staffs').update({ ...normalized, user_id: linkedUserId, office_id: officeId }).eq('id', staffId);
    if (error) throw sanitizeDbError(error, 'action.staffs');
  } else {
    const { data, error } = await supabaseAdmin.from('staffs').insert({ organization_id: organizationId, ...normalized, user_id: linkedUserId, office_id: officeId }).select('id').single();
    if (error || !data) throw new Error(error?.message || 'スタッフを作成できませんでした');
    staffId = data.id;
  }
  await recordAuditEvent({
    organizationId,
    actorId: userId,
    action: values.staffId ? 'staff.update' : 'staff.create',
    resourceType: 'staff',
    resourceId: staffId,
  });
  return { success: true, staffId };
}
```

- [ ] **Step 2: `staff/page.tsx` にUIを追加する**

1. `StaffData` 型（`src/app/app/staff/page.tsx:43-53`）に `office_id: string | null;` を追加
2. `fetchStaffData` の Supabase select（`:91`）に `office_id` を追加: `` `id, name, positions, employment_type, work_style, user_id, archived_at, sort_order, office_id, profiles:profiles!user_id(name)` ``
3. `StaffPageData` / `initialStaffPageData`（`:55-64`）に `officeList: Office[]` を追加し、`fetchStaffData` 内で `getOffices(currentOrg.id)` を呼んで含める（import: `import { getOffices, type Office } from '@/app/actions/offices';`）
4. state追加（`:81` 付近）: `const [officeId, setOfficeId] = useState<string>('none');`
5. `handleSave`（`:135-154`）の `saveStaff` 呼び出しに `officeId: officeId === 'none' ? null : officeId` を追加
6. `handleOpenAdd` / `handleOpenEdit`（`:156-165`）でそれぞれ `setOfficeId('none')` / `setOfficeId(staff.office_id || 'none')` を追加
7. ダイアログJSX（`:410-425`）の `workStyle` の `SelectField` の直後に追加:

```tsx
                <SelectField
                    value={officeId}
                    onChange={setOfficeId}
                    label="所属事業所"
                    options={[{ value: 'none', label: '未設定' }, ...officeList.map((office) => ({ value: office.id, label: office.name }))]}
                />
```

（`officeList` は `const { staffList, accountList, positionPresets, officeList } = staffPageData;` のように分割代入に追加する）

- [ ] **Step 3: 動作確認**

Run: `npm run dev` でスタッフ管理画面を開き、追加・編集ダイアログに「所属事業所」セレクトが表示され、選択して保存後に一覧再取得しても選択値が保持されることをブラウザで確認する。

- [ ] **Step 4: typecheck / lint**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/actions/staffs.ts src/app/app/staff/page.tsx
git commit -m "feat: allow assigning staff to an office"
```

---

### Task 5: 利用者に所属事業所を設定できるようにする

**Files:**
- Modify: `src/app/actions/clients.ts`
- Modify: `src/app/app/clients/page.tsx`

**Interfaces:**
- Consumes: `getOffices`, `type Office` from `@/app/actions/offices`
- Produces: `updateClientOffice(organizationId: string, clientId: string, officeId: string | null): Promise<{ success: true }>`

- [ ] **Step 1: `clients.ts` に `updateClientOffice` を追加する**

`src/app/actions/clients.ts` の `updateClientName`（`:39-47`）の直後に追加する:

```typescript
export async function updateClientOffice(organizationId: string, clientId: string, officeId: string | null) {
  const { userId } = await assertOrgPermission(organizationId, 'clients');
  await assertClientOrg(clientId, organizationId);
  if (officeId) {
    const { data: office } = await supabaseAdmin.from('offices').select('id').eq('id', officeId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
    if (!office) throw new Error('選択された事業所が見つかりません');
  }
  const { error } = await supabaseAdmin.from('clients').update({ office_id: officeId }).eq('id', clientId);
  if (error) throw sanitizeDbError(error, 'action.clients');
  await recordAuditEvent({ organizationId, actorId: userId, action: 'client.update_office', resourceType: 'client', resourceId: clientId });
  return { success: true };
}
```

（同ファイルで既に `sanitizeDbError`, `recordAuditEvent`, `assertOrgPermission`, `supabaseAdmin`, `assertClientOrg` がインポート・定義済みであることを確認し、無ければ他の関数と同じインポートを使う）

- [ ] **Step 2: `clients/page.tsx` にUIを追加する**

1. import追加: `import { createClient, setClientArchived, softDeleteClient, updateClientName, updateClientOffice } from '@/app/actions/clients';` と `import { getOffices, type Office } from '@/app/actions/offices';` と `SelectField` を `@/components/ui` から追加
2. `Client` 型（`:20-26`）に `office_id: string | null;` を追加
3. `fetchClients` の select（`:52`）に `office_id` を追加: `'id, name, created_at, archived_at, office_id, assignments(staff_id)'`
4. state追加: `const [officeList, setOfficeList] = useState<Office[]>([]);` と編集用 `const [editOfficeId, setEditOfficeId] = useState<string>('none');`
5. `useEffect(() => { if (!wsLoading && currentOrg) fetchClients(); }, ...)` の直後に事業所一覧取得の `useEffect` を追加:

```tsx
  useEffect(() => {
    if (!currentOrg) return;
    getOffices(currentOrg.id).then(setOfficeList).catch((e) => console.error(e));
  }, [currentOrg]);
```

6. `handleOpenEdit`（`:92`）を変更: `const handleOpenEdit = (client: Client) => { setEditId(client.id); setEditName(client.name); setEditOfficeId(client.office_id || 'none'); setOpenEdit(true); };`
7. `handleUpdateClient`（`:94-108`）の `updateClientName` 呼び出しの後に事業所更新を追加:

```typescript
  const handleUpdateClient = async () => {
      if (!editName.trim()) return;
      setIsSubmitting(true);
      try {
          const result = await updateClientName(currentOrg!.id, editId, editName);
          const officeIdToSave = editOfficeId === 'none' ? null : editOfficeId;
          await updateClientOffice(currentOrg!.id, editId, officeIdToSave);
          setClients(clients.map(c => c.id === editId ? { ...c, name: result.name, office_id: officeIdToSave } : c));
          setOpenEdit(false);
          showToast('更新しました');
      } catch (error) {
          console.error(error);
          showToast('更新に失敗しました', 'error');
      } finally {
          setIsSubmitting(false);
      }
  };
```

8. 編集ダイアログ（`:223-225`）に `SelectField` を追加:

```tsx
      <AppDialog open={openEdit} onClose={() => setOpenEdit(false)} title="利用者名の変更" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenEdit(false)}>キャンセル</AppButton><AppButton loading={isSubmitting} onClick={handleUpdateClient}>保存</AppButton></>}>
        <Stack spacing={2} mt={1}>
          <AppTextField autoFocus margin="dense" label="利用者氏名" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <SelectField
              value={editOfficeId}
              onChange={setEditOfficeId}
              label="所属事業所"
              options={[{ value: 'none', label: '未設定' }, ...officeList.map((office) => ({ value: office.id, label: office.name }))]}
          />
        </Stack>
      </AppDialog>
```

（`Stack` は既に `@/components/ui/mui` からimport済みなのでそのまま使う）

- [ ] **Step 3: 動作確認**

Run: `npm run dev` で利用者管理画面を開き、「氏名を編集」ダイアログに「所属事業所」セレクトが表示され、選択・保存できることをブラウザで確認する。

- [ ] **Step 4: typecheck / lint**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/actions/clients.ts src/app/app/clients/page.tsx
git commit -m "feat: allow assigning clients to an office"
```

---

### Task 6: 提供記録の交通費単価を担当スタッフの所属事業所から算出する

**Files:**
- Modify: `src/app/app/record/[clientId]/page.tsx`

**Interfaces:**
- Consumes: `offices` テーブル（`office_id`, `travel_cost_rate_yen_per_km`）、`staffs.office_id`
- Produces: `HelperProfile` 型に `defaultTravelCostRateYenPerKm: number` を追加し、スタッフ選択に応じて `travelCostRateYenPerKm` を切り替える

- [ ] **Step 1: データ取得部分を変更する**

`src/app/app/record/[clientId]/page.tsx:460-505` の `Promise.all` 内、`organizations` からの単価取得（`:484-488`）を、スタッフの所属事業所経由の単価取得に置き換える:

```typescript
    try {
      const [
        { data: client },
        { data: tmpl },
        { data: staffsData },
        { data: assignmentRows },
        { data: officesData },
        { data: serviceTypeData },
        { data: staffRoleData },
      ] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
        supabase
          .from('staffs')
          .select('id, name, user_id, office_id')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true }),
        supabase
          .from('assignments')
          .select('staff_id, round_trip_distance_km')
          .eq('client_id', clientId),
        supabase
          .from('offices')
          .select('id, travel_cost_rate_yen_per_km')
          .eq('organization_id', currentOrg.id)
          .is('archived_at', null),
        supabase
          .from('service_types')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        supabase
          .from('staff_roles')
          .select('id, name')
          .eq('organization_id', currentOrg.id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ]);

      if (client) {
        setClientName(client.name);
        const schema = (tmpl?.schema as FormItem[]) || DEFAULT_TEMPLATE;
        setTemplate(schema.filter(i => !['service_time', 'travel_time', 'round_trip_distance_km', 'travel_cost_yen'].includes(i.id)));
      }

      const distanceByStaffId = new Map((assignmentRows || []).map((assignment) => [assignment.staff_id, Number(assignment.round_trip_distance_km || 0)]));
      const rateByOfficeId = new Map((officesData || []).map((office) => [office.id, Number(office.travel_cost_rate_yen_per_km)]));
      const allStaffs = (staffsData || []).map(s => ({
        id: s.id,
        name: s.name,
        user_id: s.user_id,
        defaultRoundTripDistanceKm: distanceByStaffId.get(s.id) || 0,
        defaultTravelCostRateYenPerKm: (s.office_id && rateByOfficeId.get(s.office_id)) ?? 20,
      }));
      setSelectableStaffs(allStaffs);

      setServiceTypes((serviceTypeData ?? []) as ServiceTypeOption[]);
      setStaffRoles((staffRoleData ?? []) as StaffRoleOption[]);

      if (!currentReportId && !shiftId && userId) {
        const myStaffRecord = allStaffs.find(s => s.user_id === userId);
        if (myStaffRecord) {
            setSelectedHelpers([myStaffRecord.name]);
            setActualStaffs([{ staff_id: myStaffRecord.id, staff_role_id: null }]);
            setRoundTripDistanceKm(String(myStaffRecord.defaultRoundTripDistanceKm || 0));
            setTravelCostRateYenPerKm(myStaffRecord.defaultTravelCostRateYenPerKm);
        }
      }
    } catch (error) { console.error('Error fetching base data:', error); }
  }, [clientId, currentOrg, currentReportId, setActualStaffs, setClientName, setRoundTripDistanceKm, setSelectableStaffs, setServiceTypes, setStaffRoles, setTemplate, setTravelCostRateYenPerKm, shiftId, userId]);
```

（`setTravelCostRateYenPerKm` の依存配列への追加を忘れないこと。この変更で `orgData`／`setTravelCostRateYenPerKm(Number(orgData?.travel_cost_rate_yen_per_km ?? 20));` の行は削除される）

- [ ] **Step 2: `HelperProfile` 型を更新する**

`src/app/app/record/[clientId]/page.tsx:46` を変更:

```typescript
type HelperProfile = { id: string; name: string; defaultRoundTripDistanceKm?: number; defaultTravelCostRateYenPerKm?: number };
```

- [ ] **Step 3: スタッフ選択時に単価も切り替わるようにする**

`:615-618`（距離touched判定の自動反映effect）を変更:

```typescript
  useEffect(() => {
    if (currentReportId || distanceTouched || selectableStaffs.length === 0 || selectedHelpers.length === 0) return;
    const staff = selectableStaffs.find((helper) => helper.name === selectedHelpers[0]);
    if (staff) {
      setRoundTripDistanceKm(String(staff.defaultRoundTripDistanceKm || 0));
      setTravelCostRateYenPerKm(staff.defaultTravelCostRateYenPerKm ?? 20);
    }
  }, [currentReportId, distanceTouched, selectableStaffs, selectedHelpers, setRoundTripDistanceKm, setTravelCostRateYenPerKm]);
```

`:963-969` 付近（AI下書き反映時の同種のロジック）も同様に、`setRoundTripDistanceKm` の直後で `setTravelCostRateYenPerKm(staff.defaultTravelCostRateYenPerKm ?? 20);` を呼ぶよう変更する（該当箇所を実装時に読み直し、既存の `if (!currentReportId && !distanceTouched) { const staff = ...; if (staff) setRoundTripDistanceKm(...); }` ブロックに1行追加する）。

- [ ] **Step 4: 既存提供記録読み込み時のフォールバックを確認する**

`:596`（`setTravelCostRateYenPerKm(Number(data.travel_cost_rate_yen_per_km || travelCostRateYenPerKm || 20));`）は提供記録データに保存済みの単価をそのまま復元するロジックであり、変更不要。過去記録の値は凍結されたまま正しく表示される。

- [ ] **Step 5: 動作確認**

Run: `npm run dev` で提供記録作成画面を開き、担当スタッフを切り替えたときに交通費単価（Chip表示 `交通費 ○○円（△△円/km）`）が、そのスタッフの所属事業所の単価に応じて変わることをブラウザで確認する。所属事業所未設定のスタッフを選んだ場合は20円/kmにフォールバックされることも確認する。

- [ ] **Step 6: typecheck / lint**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/app/app/record/\[clientId\]/page.tsx
git commit -m "fix: derive travel cost rate from assigned staff's office instead of organization"
```

---

### Task 7: 最終確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全体テストを実行する**

Run: `npm run typecheck && npm run lint && npm run test:unit`
Expected: すべて成功

- [ ] **Step 2: RLS変更を伴うため、ローカルSupabaseでの検証を再確認する**

Run: `supabase test db` （または `supabase/tests/security_hardening.test.sql` を実行する既存コマンド）
Expected: 全ケースPASS

- [ ] **Step 3: 変更内容の整合性確認**

`permissions.ts` と RLS ポリシーの整合（今回は新規権限エリアを追加せず既存 `'organization'` を流用したため、差分なしであることを確認）、および `organizations.travel_cost_rate_yen_per_km` カラムを削除していないこと（意図的に残置）を変更サマリに明記する。

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


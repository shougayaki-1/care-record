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


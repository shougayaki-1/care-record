'use client';

import type { Dispatch, SetStateAction } from 'react';

import type { AssignmentPermissionHint } from '@/app/actions/clients';
import { CheckboxGroupField } from '@/components/ui';
import { Alert, Box, Card, CardContent, Chip, Stack, TextField, Typography } from '@/components/ui/mui';

export type ClientStaffOption = { id: string; name: string; userId: string | null };

type Props = {
  allStaffs: ClientStaffOption[];
  assignedStaffIds: string[];
  setAssignedStaffIds: Dispatch<SetStateAction<string[]>>;
  defaultTravelCosts: Record<string, string>;
  setDefaultTravelCosts: Dispatch<SetStateAction<Record<string, string>>>;
  permissionHints: AssignmentPermissionHint[];
};

export function StaffAssignmentTab({
  allStaffs,
  assignedStaffIds,
  setAssignedStaffIds,
  defaultTravelCosts,
  setDefaultTravelCosts,
  permissionHints,
}: Props) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>この利用者を担当するスタッフを選択してください</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>選択したスタッフのみが記録入力画面に表示されます。通常の交通費は訪問1回あたりの初期値で、その日の記録で変更できます。</Typography>
        {permissionHints.some((hint) => hint.canCreateAllRecords && !assignedStaffIds.includes(hint.staffId)) && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight="bold" gutterBottom>以下のスタッフは担当に入っていませんが、全体の記録作成権限を持つため記録を作成できます:</Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              {allStaffs
                .filter((staff) => !assignedStaffIds.includes(staff.id) && permissionHints.find((hint) => hint.staffId === staff.id)?.canCreateAllRecords)
                .map((staff) => <Chip key={staff.id} label={staff.name} size="small" color="info" variant="outlined" />)}
            </Stack>
          </Alert>
        )}
        <Stack spacing={3}>
          <CheckboxGroupField label="メンバー（ログインユーザー）" options={allStaffs.filter((staff) => staff.userId !== null)} value={assignedStaffIds} onChange={setAssignedStaffIds} getOptionLabel={(staff) => staff.name} getOptionValue={(staff) => staff.id} />
          <CheckboxGroupField label="アカウントなし（転記用）" options={allStaffs.filter((staff) => staff.userId === null)} value={assignedStaffIds} onChange={setAssignedStaffIds} getOptionLabel={(staff) => staff.name} getOptionValue={(staff) => staff.id} />
          {assignedStaffIds.length > 0 && (
            <Box sx={{ p: 2, bgcolor: 'background.muted', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>スタッフ別 通常の交通費</Typography>
              <Stack spacing={1.5}>
                {allStaffs.filter((staff) => assignedStaffIds.includes(staff.id)).map((staff) => (
                  <Stack key={staff.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Box sx={{ minWidth: { sm: 180 } }}><Typography sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{staff.name}</Typography></Box>
                    <TextField label="1訪問あたり" type="number" size="small" value={defaultTravelCosts[staff.id] ?? ''} onChange={(event) => setDefaultTravelCosts((previous) => ({ ...previous, [staff.id]: event.target.value }))} onWheel={(event) => (event.target as HTMLElement).blur()} helperText="空欄は記録時に入力。0円も設定できます" sx={{ maxWidth: { sm: 280 } }} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">円</Typography> }, htmlInput: { inputMode: 'numeric', step: '1', min: 0, max: 100000 } }} />
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

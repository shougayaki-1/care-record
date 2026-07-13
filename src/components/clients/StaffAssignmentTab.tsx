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
  roundTripDistances: Record<string, string>;
  setRoundTripDistances: Dispatch<SetStateAction<Record<string, string>>>;
  permissionHints: AssignmentPermissionHint[];
};

export function StaffAssignmentTab({
  allStaffs,
  assignedStaffIds,
  setAssignedStaffIds,
  roundTripDistances,
  setRoundTripDistances,
  permissionHints,
}: Props) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>この利用者を担当するスタッフを選択してください</Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>選択したスタッフのみが、記録入力画面の「担当ヘルパー」選択肢に表示されます。往復距離は記録作成時の初期値になります。</Typography>
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
              <Typography variant="subtitle2" fontWeight="bold" gutterBottom>スタッフ別 往復移動距離</Typography>
              <Stack spacing={1.5}>
                {allStaffs.filter((staff) => assignedStaffIds.includes(staff.id)).map((staff) => (
                  <Stack key={staff.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Box sx={{ minWidth: { sm: 180 } }}><Typography sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{staff.name}</Typography></Box>
                    <TextField label="往復距離" type="number" size="small" value={roundTripDistances[staff.id] ?? '0'} onChange={(event) => setRoundTripDistances((previous) => ({ ...previous, [staff.id]: event.target.value }))} onWheel={(event) => (event.target as HTMLElement).blur()} sx={{ maxWidth: { sm: 220 } }} slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">km</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.1', min: 0 } }} />
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

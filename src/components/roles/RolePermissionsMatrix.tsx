'use client';

import React from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, ToggleButton, ToggleButtonGroup, Typography, Box, Stack,
} from '@/components/ui/mui';
import type { RolePermissions, RecordScope } from '@/utils/permissions';

type Props = {
  value: RolePermissions;
  onChange: (next: RolePermissions) => void;
  disabled?: boolean;
};

const SCOPE_LABELS: Record<RecordScope, string> = {
  all: '全体',
  assigned: '担当',
  none: '×',
};

function ScopeToggle({
  scope, onChange, allowAssigned = true,
}: {
  scope: RecordScope;
  onChange: (s: RecordScope) => void;
  allowAssigned?: boolean;
}) {
  const options: RecordScope[] = allowAssigned ? ['all', 'assigned', 'none'] : ['all', 'none'];
  return (
    <ToggleButtonGroup
      value={scope}
      exclusive
      onChange={(_, v) => v && onChange(v as RecordScope)}
      size="small"
      sx={{ whiteSpace: 'nowrap' }}
    >
      {options.map(opt => (
        <ToggleButton key={opt} value={opt} sx={{ minWidth: 36, px: 1, py: 0.25, fontSize: '0.7rem' }}>
          {SCOPE_LABELS[opt]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

type RecordAction = keyof RolePermissions['records'];
type ShiftAction = keyof RolePermissions['shifts'];

const RECORD_ROWS: Array<{ label: string; action: RecordAction; allowAssigned: boolean }> = [
  { label: '閲覧', action: 'view',    allowAssigned: true },
  { label: '作成', action: 'create',  allowAssigned: true },
  { label: '編集', action: 'edit',    allowAssigned: true },
  { label: '削除', action: 'delete',  allowAssigned: false },
  { label: '承認', action: 'approve', allowAssigned: false },
];

const MGMT_ITEMS: Array<{ label: string; key: keyof RolePermissions['management'] }> = [
  { label: 'スタッフ管理', key: 'staffs' },
  { label: 'クライアント管理', key: 'clients' },
  { label: 'アカウント管理', key: 'accounts' },
  { label: '組織設定', key: 'organization' },
  { label: '連携設定', key: 'integrations' },
  { label: '監査ログ', key: 'auditLogs' },
  { label: 'レポート閲覧', key: 'reports' },
];

export default function RolePermissionsMatrix({ value, onChange, disabled }: Props) {
  const setRecords = (action: RecordAction, scope: RecordScope) =>
    onChange({ ...value, records: { ...value.records, [action]: scope } });
  const setShifts = (action: ShiftAction, scope: RecordScope) =>
    onChange({ ...value, shifts: { ...value.shifts, [action]: scope } });
  const setMgmt = (area: keyof RolePermissions['management'], checked: boolean) =>
    onChange({ ...value, management: { ...value.management, [area]: checked } });

  return (
    <Box sx={{ minWidth: 0, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 680 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>リソース</TableCell>
              {RECORD_ROWS.map(r => <TableCell key={r.action} align="center" sx={{ whiteSpace: 'nowrap' }}>{r.label}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {(['records', 'shifts'] as const).map(resource => (
              <TableRow key={resource}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{resource === 'records' ? '記録' : 'シフト'}</TableCell>
                {RECORD_ROWS.map(r => (
                  <TableCell key={r.action} align="center">
                    <ScopeToggle
                      scope={value[resource][r.action] as RecordScope}
                      onChange={s =>
                        resource === 'records'
                          ? setRecords(r.action, s)
                          : setShifts(r.action as ShiftAction, s)
                      }
                      allowAssigned={r.allowAssigned}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        {(['records', 'shifts'] as const).map(resource => (
          <Box
            key={resource}
            sx={{
              p: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="subtitle2" fontWeight="bold" mb={1}>
              {resource === 'records' ? '記録' : 'シフト'}
            </Typography>
            <Stack spacing={1}>
              {RECORD_ROWS.map(r => (
                <Stack key={r.action} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {r.label}
                  </Typography>
                  <ScopeToggle
                    scope={value[resource][r.action] as RecordScope}
                    onChange={s =>
                      resource === 'records'
                        ? setRecords(r.action, s)
                        : setShifts(r.action as ShiftAction, s)
                    }
                    allowAssigned={r.allowAssigned}
                  />
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>

      <Typography variant="subtitle2" mt={2} mb={1}>管理機能アクセス</Typography>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }} gap={0.5}>
        {MGMT_ITEMS.map(item => (
          <Box key={item.key} display="flex" alignItems="center">
            <Checkbox
              size="small"
              checked={value.management[item.key]}
              onChange={e => setMgmt(item.key, e.target.checked)}
            />
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

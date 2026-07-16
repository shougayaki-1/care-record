'use client';

import React from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, ToggleButton, ToggleButtonGroup, Typography, Box, Stack, Tooltip,
} from '@/components/ui/mui';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
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
type InternalWorkAction = keyof RolePermissions['internalWork'];

const RECORD_ROWS: Array<{ label: string; action: RecordAction; allowAssigned: boolean }> = [
  { label: '閲覧', action: 'view',    allowAssigned: true },
  { label: '作成', action: 'create',  allowAssigned: true },
  { label: '編集', action: 'edit',    allowAssigned: true },
  { label: '削除', action: 'delete',  allowAssigned: false },
  { label: '承認', action: 'approve', allowAssigned: false },
];

const SHIFT_ROWS: Array<{ label: string; action: ShiftAction; allowAssigned: boolean }> = [
  { label: '閲覧', action: 'view',   allowAssigned: true },
  { label: '作成', action: 'create', allowAssigned: true },
  { label: '編集', action: 'edit',   allowAssigned: true },
  { label: '削除', action: 'delete', allowAssigned: false },
];

const INTERNAL_WORK_ROWS: Array<{ label: string; action: InternalWorkAction; allowAssigned: boolean }> = [
  { label: '閲覧', action: 'view', allowAssigned: true },
  { label: '作成', action: 'create', allowAssigned: true },
];

const MGMT_ITEMS: Array<{ label: string; key: keyof RolePermissions['management']; description: string }> = [
  { label: 'スタッフ管理', key: 'staffs', description: 'スタッフ名簿、役職、アカウント紐付けを編集できます。' },
  { label: '利用者管理', key: 'clients', description: '利用者の追加、フォーム設定、担当スタッフ設定を編集できます。' },
  { label: 'アカウント管理', key: 'accounts', description: '招待、除名、メンバーの業務ロール割当を変更できます。' },
  { label: '事業所設定', key: 'organization', description: '事業所名、交通費、労働時間ルールなどを変更できます。' },
  { label: '連携設定', key: 'integrations', description: 'Googleドライブ、Googleカレンダーなどの外部連携を変更できます。' },
  { label: '操作ログ', key: 'auditLogs', description: '監査ログと過去ログを閲覧・エクスポートできます。' },
  { label: 'バックアップ状況', key: 'backupStatus', description: 'バックアップの成否と退避データを閲覧できます。復元権限は含みません。' },
  { label: '予実・記録一覧', key: 'reports', description: '記録一覧、承認、予実管理、集計画面にアクセスできます。' },
  { label: 'ロール管理', key: 'roles', description: '業務ロールの作成、編集、削除ができます。' },
  { label: '事業所削除', key: 'organizationDelete', description: '事業所を削除状態にできます。通常は付与しないでください。' },
  { label: 'オーナー移譲', key: 'ownerTransfer', description: '事業所オーナーを別メンバーへ移譲できます。' },
];

export default function RolePermissionsMatrix({ value, onChange, disabled }: Props) {
  const setRecords = (action: RecordAction, scope: RecordScope) =>
    onChange({ ...value, records: { ...value.records, [action]: scope } });
  const setShifts = (action: ShiftAction, scope: RecordScope) =>
    onChange({ ...value, shifts: { ...value.shifts, [action]: scope } });
  const setInternalWork = (action: InternalWorkAction, scope: RecordScope) =>
    onChange({ ...value, internalWork: { ...value.internalWork, [action]: scope } });
  const setMgmt = (area: keyof RolePermissions['management'], checked: boolean) =>
    onChange({ ...value, management: { ...value.management, [area]: checked } });

  return (
    <Box sx={{ minWidth: 0, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <Box sx={{ mb: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.subtle' }}>
        <Typography variant="caption" color="text.secondary" display="block">
          「全体」は担当に関係なく操作できます。「担当」はその利用者またはシフトの担当者に紐付いている場合だけ操作できます。「×」は許可しません。
        </Typography>
      </Box>

      <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 680 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>リソース</TableCell>
              {RECORD_ROWS.map(r => <TableCell key={r.action} align="center" sx={{ whiteSpace: 'nowrap' }}>{r.label}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>記録</TableCell>
              {RECORD_ROWS.map(r => (
                <TableCell key={r.action} align="center">
                  <ScopeToggle
                    scope={value.records[r.action]}
                    onChange={s => setRecords(r.action, s)}
                    allowAssigned={r.allowAssigned}
                  />
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>シフト</TableCell>
              {SHIFT_ROWS.map(r => (
                <TableCell key={r.action} align="center">
                  <ScopeToggle
                    scope={value.shifts[r.action]}
                    onChange={s => setShifts(r.action, s)}
                    allowAssigned={r.allowAssigned}
                  />
                </TableCell>
              ))}
              {/* 承認列はシフトに存在しないため空セル */}
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>内勤</TableCell>
              {INTERNAL_WORK_ROWS.map(r => (
                <TableCell key={r.action} align="center">
                  <ScopeToggle
                    scope={value.internalWork[r.action]}
                    onChange={s => setInternalWork(r.action, s)}
                    allowAssigned={r.allowAssigned}
                  />
                </TableCell>
              ))}
              <TableCell />
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' } }}>
        <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle2" fontWeight="bold" mb={1}>記録</Typography>
          <Stack spacing={1}>
            {RECORD_ROWS.map(r => (
              <Stack key={r.action} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {r.label}
                </Typography>
                <ScopeToggle
                  scope={value.records[r.action]}
                  onChange={s => setRecords(r.action, s)}
                  allowAssigned={r.allowAssigned}
                />
              </Stack>
            ))}
          </Stack>
        </Box>
        <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle2" fontWeight="bold" mb={1}>シフト</Typography>
          <Stack spacing={1}>
            {SHIFT_ROWS.map(r => (
              <Stack key={r.action} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {r.label}
                </Typography>
                <ScopeToggle
                  scope={value.shifts[r.action]}
                  onChange={s => setShifts(r.action, s)}
                  allowAssigned={r.allowAssigned}
                />
              </Stack>
            ))}
          </Stack>
        </Box>
        <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          <Typography variant="subtitle2" fontWeight="bold" mb={1}>内勤</Typography>
          <Stack spacing={1}>
            {INTERNAL_WORK_ROWS.map(r => (
              <Stack key={r.action} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {r.label}
                </Typography>
                <ScopeToggle
                  scope={value.internalWork[r.action]}
                  onChange={s => setInternalWork(r.action, s)}
                  allowAssigned={r.allowAssigned}
                />
              </Stack>
            ))}
          </Stack>
        </Box>
      </Stack>

      <Typography variant="subtitle2" mt={2} mb={1}>管理機能アクセス</Typography>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }} gap={0.5}>
        {MGMT_ITEMS.map(item => (
          <Box key={item.key} display="flex" alignItems="center" minWidth={0}>
            <Checkbox
              size="small"
              checked={value.management[item.key]}
              onChange={e => setMgmt(item.key, e.target.checked)}
            />
            <Typography variant="body2">{item.label}</Typography>
            <Tooltip title={item.description}>
              <HelpOutlineIcon sx={{ ml: 0.5, fontSize: 16, color: 'text.disabled' }} />
            </Tooltip>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

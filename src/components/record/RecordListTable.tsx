'use client';

import type { ReactNode } from 'react';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import {
  Box, Checkbox, Chip, Divider, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel, Tooltip, Typography,
} from '@/components/ui/mui';
import type { ChipProps } from '@mui/material/Chip';

export type RecordListRow = {
  id: string;
  status: string;
  statusColor: ChipProps['color'];
  start: string;
  end?: string;
  client: string;
  helper: string;
  detail?: ReactNode;
  actions: ReactNode;
  abnormal?: boolean;
  muted?: boolean;
};

type Props = {
  rows: RecordListRow[];
  emptyMessage?: string;
  selectedIds?: readonly string[];
  onToggle?: (id: string) => void;
  onSelectAll?: (checked: boolean) => void;
  sort?: { order: 'asc' | 'desc'; active: boolean; onChange: () => void };
};

export function RecordListTable({ rows, emptyMessage = '該当する記録がありません', selectedIds = [], onToggle, onSelectAll, sort }: Props) {
  const selectable = Boolean(onToggle);
  const date = (row: RecordListRow) => (
    <Box display="flex" alignItems="center" gap={1}>
      <Box>
        <Typography variant="body2" color={row.abnormal ? 'error' : 'inherit'} fontWeight={row.abnormal ? 'bold' : 'normal'}>{row.start}{row.end ? ' 〜' : ''}</Typography>
        {row.end && <Typography variant="body2" color={row.abnormal ? 'error' : 'text.secondary'} fontWeight={row.abnormal ? 'bold' : 'normal'}>{row.end}</Typography>}
        {row.detail}
      </Box>
      {row.abnormal && <Tooltip title="期間が24時間を超えています（入力ミスの可能性があります）"><ErrorOutlineIcon color="error" fontSize="small" /></Tooltip>}
    </Box>
  );

  return <>
    <Stack divider={<Divider />} sx={{ display: { xs: 'flex', sm: 'none' }, borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      {rows.map((row) => <Box key={row.id} sx={{ p: 1.5, opacity: row.muted ? 0.55 : 1, bgcolor: row.abnormal ? 'background.danger' : 'background.paper' }}>
        <Stack spacing={1.25}>
          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
              {selectable && <Checkbox checked={selectedIds.includes(row.id)} onChange={() => onToggle?.(row.id)} slotProps={{ input: { 'aria-label': `${row.client}の記録を選択` } }} sx={{ p: 0.5 }} />}
              <Box minWidth={0}>
                <Typography variant="subtitle2" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.client}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.helper}</Typography>
              </Box>
            </Box>
            <Chip label={row.status} color={row.statusColor} size="small" variant="outlined" />
          </Box>
          {date(row)}
          <Box display="flex" justifyContent="flex-end">{row.actions}</Box>
        </Stack>
      </Box>)}
      {rows.length === 0 && <Box sx={{ py: 5, px: 2, textAlign: 'center', color: 'text.secondary' }}>{emptyMessage}</Box>}
    </Stack>
    <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Table>
        <TableHead sx={{ bgcolor: 'background.muted' }}><TableRow>
          {selectable && <TableCell padding="checkbox" aria-label="選択"><Checkbox checked={rows.length > 0 && rows.every((row) => selectedIds.includes(row.id))} onChange={(event) => onSelectAll?.(event.target.checked)} slotProps={{ input: { 'aria-label': 'すべての記録を選択' } }} /></TableCell>}
          <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>ステータス</TableCell>
          <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
            {sort ? <TableSortLabel active={sort.active} direction={sort.order} onClick={sort.onChange}>開始 〜 終了日時</TableSortLabel> : '開始 〜 終了日時'}
          </TableCell>
          <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>利用者</TableCell>
          <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>担当</TableCell>
          <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>操作</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {rows.map((row) => <TableRow key={row.id} hover sx={{ '&:last-child td, &:last-child th': { border: 0 }, opacity: row.muted ? 0.55 : 1, bgcolor: row.abnormal ? 'background.danger' : 'inherit' }}>
            {selectable && <TableCell padding="checkbox"><Checkbox checked={selectedIds.includes(row.id)} onChange={() => onToggle?.(row.id)} slotProps={{ input: { 'aria-label': `${row.client}の記録を選択` } }} /></TableCell>}
            <TableCell><Chip label={row.status} color={row.statusColor} size="small" variant="outlined" /></TableCell>
            <TableCell>{date(row)}</TableCell>
            <TableCell>{row.client}</TableCell>
            <TableCell>{row.helper}</TableCell>
            <TableCell>{row.actions}</TableCell>
          </TableRow>)}
          {rows.length === 0 && <TableRow><TableCell colSpan={selectable ? 6 : 5} align="center" sx={{ py: 5, color: 'text.secondary' }}>{emptyMessage}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </TableContainer>
  </>;
}

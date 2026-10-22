'use client';

import React from 'react';
import { Button } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import type { ShiftVarianceRow } from '@/utils/statisticsAggregation';
import { Box, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@/components/ui/mui';
import EditNoteIcon from '@mui/icons-material/EditNote';
import EventNoteIcon from '@mui/icons-material/EventNote';

type Props = {
  shiftVarianceRows: ShiftVarianceRow[];
  shiftVarianceTotals: { plannedH: number; actualH: number };
  getRecordHref: (row: ShiftVarianceRow) => string | null;
  getShiftHref: (row: ShiftVarianceRow) => string | null;
  onNavigate: (href: string) => void;
};

export const ShiftVarianceView = React.memo(function ShiftVarianceView({ shiftVarianceRows, shiftVarianceTotals, getRecordHref, getShiftHref, onNavigate }: Props) {
  return (
    <>
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight="bold">シフト差異合計</Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip size="small" color="default" variant="outlined" label={`予定 ${shiftVarianceTotals.plannedH.toFixed(1)}h`} />
                  <Chip size="small" color="primary" label={`実績 ${shiftVarianceTotals.actualH.toFixed(1)}h`} />
                  <Chip
                      size="small"
                      color={Math.abs(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH) >= 0.1 ? 'warning' : 'default'}
                      variant="outlined"
                      label={`差異 ${(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH) >= 0 ? '+' : ''}${(shiftVarianceTotals.actualH - shiftVarianceTotals.plannedH).toFixed(1)}h`}
                  />
              </Stack>
          </Stack>
      </Box>
      <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
          <Table size="small">
              <TableHead sx={{ bgcolor: 'background.tint' }}>
                  <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>シフト日時</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>利用者名</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>担当職員</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定(h)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績(h)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異(h)</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>操作</TableCell>
                  </TableRow>
              </TableHead>
              <TableBody>
                  {shiftVarianceRows.length === 0 ? (
                      <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow>
                  ) : shiftVarianceRows.map(row => {
                      const startStr = new Date(row.startAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                      const endStr = row.endAt ? new Date(row.endAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
                      const recordHref = getRecordHref(row);
                      const shiftHref = getShiftHref(row);
                      return (
                          <TableRow
                              key={row.id}
                              hover={Boolean(recordHref)}
                              onClick={() => {
                                  if (recordHref) onNavigate(recordHref);
                              }}
                              sx={{ cursor: recordHref ? 'pointer' : 'default' }}
                          >
                              <TableCell>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                      <Typography variant="body2">{endStr ? `${startStr} - ${endStr}` : startStr}</Typography>
                                      {row.isUnplanned && <Chip label={row.isLegacyReport ? '大枠記録' : '予定なし'} size="small" color="default" variant="outlined" />}
                                      {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                  </Stack>
                              </TableCell>
                              <TableCell>{row.clientName}</TableCell>
                              <TableCell>
                                  <Stack spacing={0.5}>
                                      <Typography variant="body2">{row.staffNames}</Typography>
                                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                                          {row.hasStaffMismatch && <Chip label={`担当不一致 実績: ${row.actualStaffNames}`} size="small" color="warning" variant="outlined" />}
                                          {row.hasServiceTypeMismatch && <Chip label={`サービス不一致 実績: ${row.actualServiceTypeName}`} size="small" color="warning" variant="outlined" />}
                                          {row.isLegacyReport && <Chip label="大枠記録" size="small" color="default" variant="outlined" />}
                                      </Stack>
                                  </Stack>
                              </TableCell>
                              <TableCell align="right">{row.plannedH != null ? row.plannedH.toFixed(1) : '—'}</TableCell>
                              <TableCell align="right">{row.actualH != null ? row.actualH.toFixed(1) : '—'}</TableCell>
                              <TableCell align="right" sx={{ color: row.diffH != null && row.diffH < -0.1 ? 'error.main' : 'inherit', fontWeight: row.diffH != null && row.diffH < -0.1 ? 'bold' : 'normal' }}>
                                  {row.diffH != null ? (row.diffH >= 0 ? '+' : '') + row.diffH.toFixed(1) : '—'}
                              </TableCell>
                              <TableCell>
                                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                                      {recordHref ? (
                                          <AppButton
                                              size="small"
                                              variant={row.reportId ? 'outlined' : 'contained'}
                                              startIcon={<EditNoteIcon />}
                                              href={recordHref}
                                              component="a"
                                              onClick={(event) => event.stopPropagation()}
                                          >
                                              {row.reportId ? '実績確認' : '実績作成'}
                                          </AppButton>
                                      ) : (
                                          <Chip label="実績なし" size="small" color="warning" variant="outlined" />
                                      )}
                                      {shiftHref && (
                                          <Button
                                              size="small"
                                              variant="outlined"
                                              color="inherit"
                                              startIcon={<EventNoteIcon />}
                                              href={shiftHref}
                                              component="a"
                                              onClick={(event) => event.stopPropagation()}
                                          >
                                              シフト確認
                                          </Button>
                                      )}
                                  </Stack>
                              </TableCell>
                          </TableRow>
                      );
                  })}
              </TableBody>
          </Table>
      </TableContainer>
      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, p: 1.5 }}>
          {shiftVarianceRows.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
          ) : shiftVarianceRows.map(row => {
              const startStr = new Date(row.startAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              const endStr = row.endAt ? new Date(row.endAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
              const recordHref = getRecordHref(row);
              const shiftHref = getShiftHref(row);
              return (
                  <Box
                      key={row.id}
                      onClick={() => {
                          if (recordHref) onNavigate(recordHref);
                      }}
                      sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', cursor: recordHref ? 'pointer' : 'default' }}
                  >
                      <Stack spacing={1.25}>
                          <Box>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                  <Typography variant="caption" color="text.secondary">{endStr ? `${startStr} - ${endStr}` : startStr}</Typography>
                                      {row.isUnplanned && <Chip label={row.isLegacyReport ? '大枠記録' : '予定なし'} size="small" color="default" variant="outlined" />}
                                      {row.isMonthClipped && <Chip label="月内分" size="small" variant="outlined" />}
                                      {row.hasStaffMismatch && <Chip label="担当不一致" size="small" color="warning" variant="outlined" />}
                                      {row.hasServiceTypeMismatch && <Chip label="サービス不一致" size="small" color="warning" variant="outlined" />}
                                  </Stack>
                                  <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.clientName}</Typography>
                                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.staffNames}</Typography>
                                  {row.hasStaffMismatch && (
                                      <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
                                          実績担当: {row.actualStaffNames}
                                      </Typography>
                                  )}
                                  {row.hasServiceTypeMismatch && (
                                      <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
                                          実績サービス: {row.actualServiceTypeName}
                                      </Typography>
                                  )}
                          </Box>
                          <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1}>
                              <Box>
                                  <Typography variant="caption" color="text.secondary">予定</Typography>
                                  <Typography fontWeight="bold">{row.plannedH != null ? `${row.plannedH.toFixed(1)}h` : '—'}</Typography>
                              </Box>
                              <Box>
                                  <Typography variant="caption" color="text.secondary">実績</Typography>
                                  <Typography fontWeight="bold">{row.actualH != null ? `${row.actualH.toFixed(1)}h` : '—'}</Typography>
                              </Box>
                              <Box>
                                  <Typography variant="caption" color="text.secondary">差異</Typography>
                                  <Typography color={row.diffH != null && row.diffH < -0.1 ? 'error.main' : 'text.primary'} fontWeight={row.diffH != null && row.diffH < -0.1 ? 'bold' : 'normal'}>
                                      {row.diffH != null ? `${row.diffH >= 0 ? '+' : ''}${row.diffH.toFixed(1)}h` : '—'}
                                  </Typography>
                              </Box>
                          </Box>
                          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                              {recordHref ? (
                                  <AppButton
                                      size="small"
                                      variant={row.reportId ? 'outlined' : 'contained'}
                                      startIcon={<EditNoteIcon />}
                                      href={recordHref}
                                      component="a"
                                      onClick={(event) => event.stopPropagation()}
                                  >
                                      {row.reportId ? '実績確認' : '実績作成'}
                                  </AppButton>
                              ) : (
                                  <Chip label="実績なし" size="small" color="warning" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                              )}
                              {shiftHref && (
                                  <Button
                                      size="small"
                                      variant="outlined"
                                      color="inherit"
                                      startIcon={<EventNoteIcon />}
                                      href={shiftHref}
                                      component="a"
                                      onClick={(event) => event.stopPropagation()}
                                  >
                                      シフト確認
                                  </Button>
                              )}
                          </Stack>
                      </Stack>
                  </Box>
              );
          })}
      </Stack>
    </>
  );
});

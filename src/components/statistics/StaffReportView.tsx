'use client';

import React from 'react';
import { Button } from '@/components/ui/mui';
import type { Dispatch, SetStateAction } from 'react';
import type { LaborPremiumType } from '@/utils/laborPremium';
import type { AggregatedData, StaffDetailItem } from '@/utils/statisticsAggregation';
import { Box, Chip, Collapse, Divider, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@/components/ui/mui';
import { AppButton } from '@/components/ui';
import EditNoteIcon from '@mui/icons-material/EditNote';
import EventNoteIcon from '@mui/icons-material/EventNote';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';
import { formatDetailDateTime } from './formatDetailDateTime';

type Props = {
  tabIndex: number;
  premiumTypes: LaborPremiumType[];
  visibleAggregatedData: AggregatedData;
  expandedRows: Record<string, boolean>;
  setExpandedRows: Dispatch<SetStateAction<Record<string, boolean>>>;
  getDetailRecordHref: (item: StaffDetailItem) => string | null;
  getDetailShiftHref: (item: StaffDetailItem) => string | null;
};

export const StaffReportView = React.memo(function StaffReportView({ tabIndex, premiumTypes, visibleAggregatedData, expandedRows, setExpandedRows, getDetailRecordHref, getDetailShiftHref }: Props) {
  return (
    <>
      <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Typography variant="subtitle2" fontWeight="bold">{tabIndex === 0 ? 'スタッフ別明細' : '利用者別明細'}</Typography>
          </Stack>
      </Box>
      <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
          <Table>
              <TableHead sx={{ bgcolor: 'background.tint' }}>
                  <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>{tabIndex === 0 ? 'スタッフ名' : '利用者名'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>実績内訳</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                      {tabIndex === 0 && premiumTypes.map(t => (
                          <TableCell key={t.id} align="right" sx={{ fontWeight: 'bold' }}>{t.name}<br />予定/実績/差異(h)</TableCell>
                      ))}
                  </TableRow>
              </TableHead>
              <TableBody>
                  {visibleAggregatedData.rows.length === 0 ? <TableRow><TableCell colSpan={6 + (tabIndex === 0 ? premiumTypes.length : 0)} align="center" sx={{ py: 5, color: 'text.secondary' }}>データがありません</TableCell></TableRow> : (
                      visibleAggregatedData.rows.map((row) => {
                          const diff = row.actualHours - row.plannedHours;
                          const premiumDiff = premiumTypes.some(t => Math.abs(visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
                          const hasDiff = Math.abs(diff) >= 0.01 || premiumDiff;
                          const isExpanded = Boolean(expandedRows[row.name]);
                          const isAlert = diff < -2 || diff > 2 || premiumDiff;
                          return (
                              <React.Fragment key={row.name}>
                                  <TableRow hover>
                                      <TableCell sx={{ fontWeight: 'bold' }}>
                                          <Stack direction="row" spacing={0.5} alignItems="center">
                                              <IconButton
                                                  size="small"
                                                  disabled={!hasDiff}
                                                  onClick={() => setExpandedRows(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                                                  aria-label={isExpanded ? '差異詳細を閉じる' : '差異詳細を開く'}
                                              >
                                                  {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                                              </IconButton>
                                              <Typography fontWeight="bold">{row.name}</Typography>
                                          </Stack>
                                      </TableCell>
                                      <TableCell align="right">{row.plannedHours.toFixed(2)}</TableCell>
                                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{row.actualHours.toFixed(2)}</TableCell>
                                      <TableCell>
                                          <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="flex-start">
                                              <Chip size="small" variant="outlined" label={`サービス ${row.serviceHours.toFixed(1)}h`} />
                                              <Chip size="small" variant="outlined" label={`移動 ${row.travelHours.toFixed(1)}h`} />
                                              {tabIndex === 0 && row.internalHours > 0 && <Chip size="small" variant="outlined" label={`内勤 ${row.internalHours.toFixed(1)}h`} />}
                                          </Stack>
                                      </TableCell>
                                      <TableCell align="right" sx={{ color: isAlert ? 'error.main' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>{diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</TableCell>
                                      <TableCell>
                                          <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                              {row.statusCounts.pending > 0 && <Chip size="small" color={getReportStatusChipColor('pending')} label={`${getReportStatusLabel('pending')}あり ${row.statusCounts.pending}`} />}
                                              {row.statusCounts.remanded > 0 && <Chip size="small" color={getReportStatusChipColor('remanded')} label={`${getReportStatusLabel('remanded')}あり ${row.statusCounts.remanded}`} />}
                                              {row.statusCounts.pending === 0 && row.statusCounts.remanded === 0 && <Typography variant="caption" color="text.secondary">—</Typography>}
                                          </Stack>
                                      </TableCell>
                                      {tabIndex === 0 && premiumTypes.map(t => {
                                          const premium = visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
                                          const diffHours = premium.diff / 60;
                                          return (
                                              <TableCell key={t.id} align="right" sx={{ color: Math.abs(diffHours) >= 0.1 ? 'error.main' : 'inherit' }}>
                                                  {(premium.planned / 60).toFixed(1)} / {(premium.actual / 60).toFixed(1)} / {diffHours >= 0 ? '+' : ''}{diffHours.toFixed(1)}
                                              </TableCell>
                                          );
                                      })}
                                  </TableRow>
                                  <TableRow>
                                      <TableCell colSpan={6 + (tabIndex === 0 ? premiumTypes.length : 0)} sx={{ p: 0, borderBottom: isExpanded ? undefined : 0 }}>
                                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                              <Box sx={{ px: 3, py: 2, bgcolor: 'background.tint' }}>
                                                  <Typography variant="subtitle2" fontWeight="bold" mb={1}>差異対象シフト・実績</Typography>
                                                  <Stack spacing={1}>
                                                      {(visibleAggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
                                                          const recordHref = getDetailRecordHref(item);
                                                          const shiftHref = getDetailShiftHref(item);
                                                          return (
                                                              <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: '90px minmax(180px, 1fr) 110px minmax(180px, auto)', gap: 1, alignItems: 'center' }}>
                                                                  <Chip size="small" label={item.kind === 'planned' ? '予定' : item.kind === 'internal' ? '内勤' : '実績'} color={item.kind === 'planned' ? 'default' : item.kind === 'internal' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                                                      {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                                                      {item.isMonthClipped && <Chip size="small" label="月内分" variant="outlined" sx={{ ml: 1 }} />}
                                                                  </Typography>
                                                                  <Typography variant="body2" align="right">{item.hours.toFixed(2)}h</Typography>
                                                                  <Stack direction="row" spacing={0.75} justifyContent="flex-end" useFlexGap flexWrap="wrap">
                                                                      {recordHref && (
                                                                          <AppButton size="small" variant={item.reportId ? 'outlined' : 'contained'} startIcon={<EditNoteIcon />} href={recordHref} component="a">
                                                                              {item.reportId ? '実績確認' : '実績作成'}
                                                                          </AppButton>
                                                                      )}
                                                                      {shiftHref && (
                                                                          <Button size="small" variant="outlined" color="inherit" startIcon={<EventNoteIcon />} href={shiftHref} component="a">
                                                                              シフト確認
                                                                          </Button>
                                                                      )}
                                                                  </Stack>
                                                              </Box>
                                                          );
                                                      })}
                                                  </Stack>
                                              </Box>
                                          </Collapse>
                                      </TableCell>
                                  </TableRow>
                              </React.Fragment>
                          );
                      })
                  )}
              </TableBody>
          </Table>
      </TableContainer>
      <Stack spacing={1.5} sx={{ display: { xs: 'flex', sm: 'none' }, p: 1.5 }}>
          {visibleAggregatedData.rows.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>データがありません</Box>
          ) : visibleAggregatedData.rows.map((row, i) => {
              const diff = row.actualHours - row.plannedHours;
              const premiumDiff = premiumTypes.some(t => Math.abs(visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id]?.diff ?? 0) >= 1);
              const hasDiff = Math.abs(diff) >= 0.01 || premiumDiff;
              const isExpanded = Boolean(expandedRows[row.name]);
              const isAlert = diff < -2 || diff > 2 || premiumDiff;
              return (
                  <Box key={i} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                          <IconButton
                              size="small"
                              disabled={!hasDiff}
                              onClick={() => setExpandedRows(prev => ({ ...prev, [row.name]: !prev[row.name] }))}
                              aria-label={isExpanded ? '差異詳細を閉じる' : '差異詳細を開く'}
                          >
                              {isExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                          </IconButton>
                          <Typography fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.name}</Typography>
                      </Stack>
                      <Box display="grid" gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap={1} mt={1.5}>
                          <Box>
                              <Typography variant="caption" color="text.secondary">予定</Typography>
                              <Typography fontWeight="bold">{row.plannedHours.toFixed(2)}h</Typography>
                          </Box>
                          <Box>
                              <Typography variant="caption" color="text.secondary">実績</Typography>
                              <Typography fontWeight="bold" color="primary.main">{row.actualHours.toFixed(2)}h</Typography>
                          </Box>
                          <Box>
                              <Typography variant="caption" color="text.secondary">差異</Typography>
                              <Typography fontWeight={isAlert ? 'bold' : 'normal'} color={isAlert ? 'error.main' : 'text.primary'}>
                                  {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}h
                              </Typography>
                          </Box>
                      </Box>
                      <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
                          <Chip size="small" variant="outlined" label={`サービス ${row.serviceHours.toFixed(1)}h`} />
                          <Chip size="small" variant="outlined" label={`移動 ${row.travelHours.toFixed(1)}h`} />
                          {tabIndex === 0 && row.internalHours > 0 && <Chip size="small" variant="outlined" label={`内勤 ${row.internalHours.toFixed(1)}h`} />}
                          {row.statusCounts.pending > 0 && <Chip size="small" color={getReportStatusChipColor('pending')} label={`${getReportStatusLabel('pending')}あり ${row.statusCounts.pending}`} />}
                          {row.statusCounts.remanded > 0 && <Chip size="small" color={getReportStatusChipColor('remanded')} label={`${getReportStatusLabel('remanded')}あり ${row.statusCounts.remanded}`} />}
                      </Stack>
                      {tabIndex === 0 && premiumTypes.length > 0 && (
                          <Stack direction="row" gap={1} flexWrap="wrap" mt={1.5}>
                              {premiumTypes.map(t => {
                                  const premium = visibleAggregatedData.premiumComparisonPerStaff[row.name]?.[t.id] ?? { planned: 0, actual: 0, diff: 0 };
                                  const diffHours = premium.diff / 60;
                                  return (
                                      <Chip
                                          key={t.id}
                                          size="small"
                                          variant="outlined"
                                          color={Math.abs(diffHours) >= 0.1 ? 'error' : 'default'}
                                          label={`${t.name}: ${(premium.planned / 60).toFixed(1)} / ${(premium.actual / 60).toFixed(1)} / ${diffHours >= 0 ? '+' : ''}${diffHours.toFixed(1)}h`}
                                      />
                                  );
                              })}
                          </Stack>
                      )}
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Divider sx={{ my: 1.5 }} />
                          <Stack spacing={1}>
                              {(visibleAggregatedData.detailItemsPerStaff[row.name] ?? []).map(item => {
                                  const recordHref = getDetailRecordHref(item);
                                  const shiftHref = getDetailShiftHref(item);
                                  return (
                                      <Box key={item.id}>
                                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                              <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                                                  <Chip size="small" label={item.kind === 'planned' ? '予定' : item.kind === 'internal' ? '内勤' : '実績'} color={item.kind === 'planned' ? 'default' : item.kind === 'internal' ? 'default' : 'primary'} variant={item.kind === 'planned' ? 'outlined' : 'filled'} />
                                                  {item.isMonthClipped && <Chip size="small" label="月内分" variant="outlined" />}
                                              </Stack>
                                              <Typography variant="body2" fontWeight="bold">{item.hours.toFixed(2)}h</Typography>
                                          </Stack>
                                          <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                                              {item.clientName} {formatDetailDateTime(item.startAt)} - {formatDetailDateTime(item.endAt)}
                                          </Typography>
                                          {(recordHref || shiftHref) && (
                                              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" mt={1}>
                                                  {recordHref && (
                                                      <AppButton size="small" variant={item.reportId ? 'outlined' : 'contained'} startIcon={<EditNoteIcon />} href={recordHref} component="a">
                                                          {item.reportId ? '実績確認' : '実績作成'}
                                                      </AppButton>
                                                  )}
                                                  {shiftHref && (
                                                      <Button size="small" variant="outlined" color="inherit" startIcon={<EventNoteIcon />} href={shiftHref} component="a">
                                                          シフト確認
                                                      </Button>
                                                  )}
                                              </Stack>
                                          )}
                                      </Box>
                                  );
                              })}
                          </Stack>
                      </Collapse>
                  </Box>
              );
          })}
      </Stack>
    </>
  );
});

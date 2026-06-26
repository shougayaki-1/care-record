'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, MenuItem, Select, InputAdornment, Chip,
} from '@/components/ui/mui';
import BackupIcon from '@mui/icons-material/Backup';
import SearchIcon from '@mui/icons-material/Search';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { checkManagementPermission } from '@/utils/permissions';
import { listDailyBackups, getBackupRecords, triggerDailyBackup } from '@/app/actions/backup';
import type { BackupFileEntry, BackupRecord } from '@/app/actions/backup';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton } from '@/components/ui';

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  pending: '承認待ち',
  approved: '承認済み',
  remanded: '差し戻し',
};

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  draft: 'default',
  pending: 'warning',
  approved: 'success',
  remanded: 'error',
};

export default function BackupPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const router = useRouter();
  const { showToast } = useToast();

  const [files, setFiles] = useState<BackupFileEntry[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      if (!checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs')) {
        router.push('/app');
      }
    }
  }, [wsLoading, currentOrg, router]);

  const refreshFiles = useCallback(async (orgId: string, keepDate?: string) => {
    setLoadingFiles(true);
    setError(null);
    try {
      const data = await listDailyBackups(orgId);
      setFiles(data);
      if (!keepDate && data.length > 0) setSelectedDate(data[0].date);
    } catch {
      setError('バックアップファイルの取得に失敗しました');
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (!currentOrg) return;
    refreshFiles(currentOrg.id);
  }, [currentOrg, refreshFiles]);

  const handleTriggerBackup = async () => {
    if (!currentOrg) return;
    setTriggering(true);
    try {
      const { date, records } = await triggerDailyBackup(currentOrg.id);
      showToast(`バックアップ完了（${date}：${records} 件）`, 'success');
      await refreshFiles(currentOrg.id, date);
      setSelectedDate(date);
    } catch {
      showToast('バックアップに失敗しました', 'error');
    } finally {
      setTriggering(false);
    }
  };

  const loadRecords = useCallback(async (orgId: string, date: string) => {
    setLoadingRecords(true);
    setError(null);
    setRecords([]);
    try {
      const data = await getBackupRecords(orgId, date);
      setRecords(data);
    } catch {
      setError('記録の取得に失敗しました');
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    if (currentOrg && selectedDate) {
      loadRecords(currentOrg.id, selectedDate);
    }
  }, [currentOrg, selectedDate, loadRecords]);

  const filtered = records.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!r.clientName.toLowerCase().includes(q) && !r.helperName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (wsLoading || !currentOrg) {
    return <Box p={5} textAlign="center"><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}>
        <Stack direction="row" alignItems="center" height={64} spacing={2}>
          <BackupIcon sx={{ color: 'action.active' }} />
          <Typography variant="h6" fontWeight="bold">バックアップ閲覧</Typography>
          <Box sx={{ flexGrow: 1 }} />
          <AppButton
            size="small"
            onClick={handleTriggerBackup}
            disabled={triggering}
            startIcon={triggering ? <CircularProgress size={14} color="inherit" /> : <BackupIcon fontSize="small" />}
          >
            {triggering ? 'バックアップ中...' : '今すぐバックアップ'}
          </AppButton>
        </Stack>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
        <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
          {error && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.main', bgcolor: 'background.danger' }}>
              <Typography color="error">{error}</Typography>
            </Paper>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'flex-start' }}>
            {/* ファイル一覧 */}
            <Paper variant="outlined" sx={{ borderRadius: 3, minWidth: 180, flexShrink: 0 }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ px: 2, pt: 2, pb: 1, color: 'text.secondary' }}>
                バックアップ日
              </Typography>
              {loadingFiles ? (
                <Box p={3} textAlign="center"><CircularProgress size={20} /></Box>
              ) : files.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
                  バックアップがありません
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 480, overflowY: 'auto' }}>
                  {files.map((f) => (
                    <Box
                      key={f.date}
                      onClick={() => setSelectedDate(f.date)}
                      sx={{
                        px: 2, py: 1.2, cursor: 'pointer', fontSize: 13,
                        fontWeight: selectedDate === f.date ? 700 : 400,
                        color: selectedDate === f.date ? 'primary.main' : 'text.primary',
                        bgcolor: selectedDate === f.date ? 'primary.50' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                        borderLeft: selectedDate === f.date ? '3px solid' : '3px solid transparent',
                        borderColor: selectedDate === f.date ? 'primary.main' : 'transparent',
                      }}
                    >
                      {f.date}
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>

            {/* 記録テーブル */}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={2} alignItems={{ sm: 'center' }}>
                <TextField
                  size="small"
                  placeholder="利用者名・担当者で絞り込み"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                  sx={{ minWidth: 220 }}
                />
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  displayEmpty
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="">すべて</MenuItem>
                  <MenuItem value="approved">承認済み</MenuItem>
                  <MenuItem value="pending">承認待ち</MenuItem>
                  <MenuItem value="draft">下書き</MenuItem>
                  <MenuItem value="remanded">差し戻し</MenuItem>
                </Select>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                  {loadingRecords ? '読み込み中...' : `${filtered.length} 件 / 全 ${records.length} 件`}
                </Typography>
              </Stack>

              <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
                {loadingRecords ? (
                  <Box p={5} textAlign="center"><CircularProgress /></Box>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>利用者名</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>開始日時</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>終了日時</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>担当者</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>ステータス</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                            {records.length === 0 ? 'この日のバックアップに記録がありません' : '条件に一致する記録がありません'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((r) => (
                          <TableRow key={r.id} hover>
                            <TableCell>{r.clientName}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.startAt)}</TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.endAt)}</TableCell>
                            <TableCell>{r.helperName}</TableCell>
                            <TableCell>
                              <Chip
                                label={STATUS_LABELS[r.status] ?? r.status}
                                color={STATUS_COLORS[r.status] ?? 'default'}
                                size="small"
                              />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </Paper>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

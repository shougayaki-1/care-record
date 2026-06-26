'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Stack, TextField, MenuItem, Select, InputAdornment,
} from '@/components/ui/mui';
import BackupIcon from '@mui/icons-material/Backup';
import SearchIcon from '@mui/icons-material/Search';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { checkManagementPermission } from '@/utils/permissions';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { listDailyBackups, getBackupRecords, triggerDailyBackup } from '@/app/actions/backup';
import type { BackupFileEntry, BackupRecord, ListDailyBackupsResult } from '@/app/actions/backup';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton, DataTable, InnerPageHeader, PageContainer, StatusChip } from '@/components/ui';

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

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[ぁ-ん]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .toLowerCase();
}

function matchesBackupRecord(record: BackupRecord, rawQuery: string): boolean {
  const query = normalizeSearchText(rawQuery);
  if (!query) return true;

  const searchable = [
    record.clientName,
    record.helperName,
    STATUS_LABELS[record.status] ?? record.status,
    formatDateTime(record.startAt),
    formatDateTime(record.endAt),
  ].map(normalizeSearchText);
  const combinedSearchable = searchable.join('');
  const queryTerms = rawQuery
    .trim()
    .split(/[\s\u3000]+/)
    .map(normalizeSearchText)
    .filter(Boolean);

  return (
    searchable.some((value) => value.includes(query))
    || combinedSearchable.includes(query)
    || (queryTerms.length > 1 && queryTerms.every((term) => combinedSearchable.includes(term)))
  );
}

export default function BackupPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const router = useRouter();
  const { showToast } = useToast();

  const [files, setFiles] = useState<BackupFileEntry[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [gcsNotConfigured, setGcsNotConfigured] = useState(false);
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
    setGcsNotConfigured(false);
    try {
      const result: ListDailyBackupsResult = await listDailyBackups(orgId);
      if (!result.configured) {
        setGcsNotConfigured(true);
        return;
      }
      setFiles(result.files);
      if (!keepDate && result.files.length > 0) setSelectedDate(result.files[0].date);
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
    return matchesBackupRecord(r, query);
  });

  if (wsLoading || !currentOrg) {
    return <Box p={5} textAlign="center"><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <InnerPageHeader
        icon={<BackupIcon />}
        title="バックアップ閲覧"
        actions={
          <AppButton
            size="small"
            onClick={handleTriggerBackup}
            disabled={triggering}
            startIcon={triggering ? <CircularProgress size={14} color="inherit" /> : <BackupIcon fontSize="small" />}
          >
            {triggering ? 'バックアップ中...' : '今すぐバックアップ'}
          </AppButton>
        }
      />

      <PageContainer>
        <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
          {gcsNotConfigured && (
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 2, borderColor: 'warning.main', borderRadius: 1 }}>
              <Stack spacing={1.5} alignItems="center" textAlign="center">
                <CloudOffIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                <Typography variant="h6" fontWeight="bold">GCS が設定されていません</Typography>
                <Typography variant="body2" color="text.secondary">
                  Vercel の環境変数に <code>GCP_PROJECT_ID</code> と <code>GCP_SERVICE_ACCOUNT_KEY_JSON</code> を設定してください。
                </Typography>
              </Stack>
            </Paper>
          )}

          {error && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: 'error.main', bgcolor: 'background.danger', borderRadius: 1 }}>
              <Typography color="error">{error}</Typography>
            </Paper>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems={{ md: 'flex-start' }}>
            <Paper
              variant="outlined"
              sx={{
                borderRadius: 1,
                width: { xs: '100%', md: 200 },
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
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
                <Box sx={{ maxHeight: { xs: 160, md: 480 }, overflowY: 'auto' }}>
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

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <TextField
                  size="small"
                  placeholder="利用者名・担当者で検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                  sx={{ width: { xs: '100%', sm: 280 } }}
                />
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  displayEmpty
                  sx={{ width: { xs: '100%', sm: 150 } }}
                >
                  <MenuItem value="">すべて</MenuItem>
                  <MenuItem value="approved">承認済み</MenuItem>
                  <MenuItem value="pending">承認待ち</MenuItem>
                  <MenuItem value="draft">下書き</MenuItem>
                  <MenuItem value="remanded">差し戻し</MenuItem>
                </Select>
                <Typography variant="body2" color="text.secondary" sx={{ ml: { sm: 'auto' }, textAlign: { xs: 'right', sm: 'left' } }}>
                  {loadingRecords ? '読み込み中...' : `${filtered.length} 件 / 全 ${records.length} 件`}
                </Typography>
              </Stack>

              <DataTable
                component={Paper}
                sx={{ border: 1, borderRadius: 1, borderColor: 'divider' }}
                rows={filtered}
                loading={loadingRecords}
                getRowKey={(record) => record.id}
                emptyTitle={records.length === 0 ? 'この日のバックアップに記録がありません' : '条件に一致する記録がありません'}
                minWidth={720}
                mobileCardRender={(record) => (
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1, bgcolor: 'background.paper' }}>
                    <Stack spacing={1.25}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{record.clientName}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{record.helperName}</Typography>
                        </Box>
                        <StatusChip
                          label={STATUS_LABELS[record.status] ?? record.status}
                          tone={STATUS_COLORS[record.status] ?? 'default'}
                        />
                      </Stack>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '4em minmax(0, 1fr)', gap: 0.75, color: 'text.secondary', fontSize: 13 }}>
                        <Box>開始</Box>
                        <Box>{formatDateTime(record.startAt)}</Box>
                        <Box>終了</Box>
                        <Box>{formatDateTime(record.endAt)}</Box>
                      </Box>
                    </Stack>
                  </Paper>
                )}
                columns={[
                  { key: 'clientName', header: '利用者名', render: (record) => record.clientName },
                  { key: 'startAt', header: '開始日時', render: (record) => <Box sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(record.startAt)}</Box> },
                  { key: 'endAt', header: '終了日時', render: (record) => <Box sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(record.endAt)}</Box> },
                  { key: 'helperName', header: '担当者', render: (record) => record.helperName },
                  {
                    key: 'status',
                    header: 'ステータス',
                    render: (record) => (
                      <StatusChip
                        label={STATUS_LABELS[record.status] ?? record.status}
                        tone={STATUS_COLORS[record.status] ?? 'default'}
                      />
                    ),
                  },
                ]}
              />
            </Box>
          </Stack>
        </Box>
      </PageContainer>
    </Box>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

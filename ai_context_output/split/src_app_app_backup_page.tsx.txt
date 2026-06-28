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
import { AppButton, AppDialog, DataTable, InnerPageHeader, PageContainer, StatusChip } from '@/components/ui';

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
    ...detailEntries(record.values).map((entry) => `${entry.label}${entry.value}`),
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

function uniqueOptions(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ja'));
}

function detailEntries(values: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!values) return [];
  return Object.entries(values).flatMap(([key, value]) => {
    if (key.startsWith('_')) return [];
    const formatted = formatDetailValue(value);
    if (!formatted) return [];
    return [{ label: key, value: formatted }];
  });
}

function formatDetailValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.map(formatDetailValue).filter(Boolean).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  return String(value);
}

export default function BackupPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const router = useRouter();
  const { showToast } = useToast();

  const [files, setFiles] = useState<BackupFileEntry[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [gcsNotConfigured, setGcsNotConfigured] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedBackupPath, setSelectedBackupPath] = useState<string>('');
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [helperFilter, setHelperFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<BackupRecord | null>(null);

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      if (!checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs')) {
        router.push('/app');
      }
    }
  }, [wsLoading, currentOrg, router]);

  const refreshFiles = useCallback(async (orgId: string, preferredPath?: string) => {
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
      const selected = result.files.find((file) => file.path === preferredPath) ?? result.files[0];
      if (selected) {
        setSelectedDate(selected.date);
        setSelectedBackupPath(selected.path);
      }
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
      const { date, path, records } = await triggerDailyBackup(currentOrg.id);
      showToast(`バックアップ完了（${date}：${records} 件）`, 'success');
      await refreshFiles(currentOrg.id, path);
      setSelectedDate(date);
      setSelectedBackupPath(path);
    } catch {
      showToast('バックアップに失敗しました', 'error');
    } finally {
      setTriggering(false);
    }
  };

  const loadRecords = useCallback(async (orgId: string, backupPath: string) => {
    setLoadingRecords(true);
    setError(null);
    setRecords([]);
    setSelectedRecord(null);
    try {
      const data = await getBackupRecords(orgId, backupPath);
      setRecords(data);
    } catch {
      setError('記録の取得に失敗しました');
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    if (currentOrg && selectedBackupPath) {
      loadRecords(currentOrg.id, selectedBackupPath);
    } else {
      setRecords([]);
      setSelectedRecord(null);
    }
  }, [currentOrg, selectedBackupPath, loadRecords]);

  const dateFiles = files.filter((file) => file.date === selectedDate);
  const availableDates = uniqueOptions(files.map((file) => file.date)).sort((a, b) => b.localeCompare(a));
  const clientOptions = uniqueOptions(records.map((record) => record.clientName));
  const helperOptions = uniqueOptions(records.map((record) => record.helperName));

  useEffect(() => {
    if (!selectedDate) return;
    const nextPath = dateFiles.some((file) => file.path === selectedBackupPath)
      ? selectedBackupPath
      : dateFiles[0]?.path ?? '';
    if (nextPath !== selectedBackupPath) setSelectedBackupPath(nextPath);
  }, [dateFiles, selectedBackupPath, selectedDate]);

  const filtered = records.filter((r) => {
    if (clientFilter && r.clientName !== clientFilter) return false;
    if (helperFilter && r.helperName !== helperFilter) return false;
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
                バックアップ選択
              </Typography>
              {loadingFiles ? (
                <Box p={3} textAlign="center"><CircularProgress size={20} /></Box>
              ) : files.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
                  バックアップがありません
                </Typography>
              ) : (
                <Stack spacing={1.5} sx={{ p: 2, pt: 1 }}>
                  <TextField
                    label="日付"
                    type="date"
                    value={selectedDate}
                    onChange={(event) => {
                      setSelectedDate(event.target.value);
                      setQuery('');
                      setClientFilter('');
                      setHelperFilter('');
                      setStatusFilter('');
                    }}
                    slotProps={{
                      htmlInput: {
                        min: availableDates.at(-1),
                        max: availableDates[0],
                      },
                      inputLabel: { shrink: true },
                    }}
                    fullWidth
                  />
                  <TextField
                    label="バックアップ"
                    select
                    value={selectedBackupPath}
                    onChange={(event) => setSelectedBackupPath(event.target.value)}
                    fullWidth
                    disabled={dateFiles.length === 0}
                  >
                    {dateFiles.length === 0 ? (
                      <MenuItem value="">この日のバックアップはありません</MenuItem>
                    ) : (
                      dateFiles.map((file) => (
                        <MenuItem key={file.path} value={file.path}>
                          {file.label}
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                  <Typography variant="caption" color="text.secondary">
                    {dateFiles.length > 0 ? `${dateFiles.length} 件のバックアップ` : '別の日付を選択してください'}
                  </Typography>
                </Stack>
              )}
            </Paper>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, 1.4fr) repeat(2, minmax(150px, 1fr))', lg: 'minmax(240px, 1.4fr) repeat(3, minmax(150px, 1fr)) auto' },
                  gap: 1.5,
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <TextField
                  size="small"
                  placeholder="キーワード検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
                  fullWidth
                />
                <TextField
                  select
                  label="利用者"
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">すべて</MenuItem>
                  {clientOptions.map((clientName) => <MenuItem key={clientName} value={clientName}>{clientName}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  label="ヘルパー"
                  value={helperFilter}
                  onChange={(event) => setHelperFilter(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">すべて</MenuItem>
                  {helperOptions.map((helperName) => <MenuItem key={helperName} value={helperName}>{helperName}</MenuItem>)}
                </TextField>
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  displayEmpty
                  sx={{ width: '100%' }}
                >
                  <MenuItem value="">すべて</MenuItem>
                  <MenuItem value="approved">承認済み</MenuItem>
                  <MenuItem value="pending">承認待ち</MenuItem>
                  <MenuItem value="draft">下書き</MenuItem>
                  <MenuItem value="remanded">差し戻し</MenuItem>
                </Select>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: { xs: 'right', lg: 'left' }, whiteSpace: 'nowrap' }}>
                  {loadingRecords ? '読み込み中...' : `${filtered.length} 件 / 全 ${records.length} 件`}
                </Typography>
              </Box>

              <DataTable
                component={Paper}
                sx={{ border: 1, borderRadius: 1, borderColor: 'divider' }}
                rows={filtered}
                loading={loadingRecords}
                getRowKey={(record) => record.id}
                onRowClick={(record) => setSelectedRecord(record)}
                emptyTitle={records.length === 0 ? 'この日のバックアップに記録がありません' : '条件に一致する記録がありません'}
                minWidth={820}
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
                  {
                    key: 'detail',
                    header: '詳細',
                    align: 'right',
                    render: (record) => (
                      <AppButton
                        size="small"
                        variant="text"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRecord(record);
                        }}
                      >
                        表示
                      </AppButton>
                    ),
                  },
                ]}
              />
            </Box>
          </Stack>
        </Box>
      </PageContainer>

      <AppDialog
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title="提供記録の詳細"
        maxWidth="md"
        actions={<AppButton variant="text" intent="secondary" onClick={() => setSelectedRecord(null)}>閉じる</AppButton>}
      >
        {selectedRecord && (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1, bgcolor: 'background.subtle' }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '8em minmax(0, 1fr)' },
                  gap: 1,
                  fontSize: 14,
                }}
              >
                <Typography color="text.secondary">利用者</Typography>
                <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{selectedRecord.clientName || '-'}</Typography>
                <Typography color="text.secondary">担当者</Typography>
                <Typography sx={{ overflowWrap: 'anywhere' }}>{selectedRecord.helperName || '-'}</Typography>
                <Typography color="text.secondary">開始</Typography>
                <Typography>{formatDateTime(selectedRecord.startAt)}</Typography>
                <Typography color="text.secondary">終了</Typography>
                <Typography>{formatDateTime(selectedRecord.endAt)}</Typography>
                <Typography color="text.secondary">ステータス</Typography>
                <Box>
                  <StatusChip
                    label={STATUS_LABELS[selectedRecord.status] ?? selectedRecord.status}
                    tone={STATUS_COLORS[selectedRecord.status] ?? 'default'}
                  />
                </Box>
              </Box>
            </Paper>

            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                記録内容
              </Typography>
              {detailEntries(selectedRecord.values).length === 0 ? (
                <Typography variant="body2" color="text.secondary">詳細内容は保存されていません</Typography>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(9em, 14em) minmax(0, 1fr)' }, borderTop: 1, borderColor: 'divider' }}>
                  {detailEntries(selectedRecord.values).map((entry) => (
                    <Box
                      key={`${entry.label}:${entry.value}`}
                      sx={{
                        display: 'contents',
                        '& > *': { borderBottom: 1, borderColor: 'divider', py: 1, minWidth: 0 },
                      }}
                    >
                      <Typography variant="body2" color="text.secondary" sx={{ pr: { sm: 2 }, overflowWrap: 'anywhere' }}>
                        {entry.label}
                      </Typography>
                      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                        {entry.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Stack>
        )}
      </AppDialog>
    </Box>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

'use client';

import { useEffect, useState } from 'react';
import {
  Alert, Box, Typography, CircularProgress, Stack, TextField, MenuItem, InputAdornment,
} from '@/components/ui/mui';
import BackupIcon from '@mui/icons-material/Backup';
import SearchIcon from '@mui/icons-material/Search';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { checkManagementPermission } from '@/utils/permissions';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import type { BackupRecord } from '@/app/actions/backup';
import { useToast } from '@/components/ui/ToastProvider';
import { AppButton, AppDialog, DataTable, InnerPageHeader, PageContainer, PageLayout, SelectField, StatusChip } from '@/components/ui';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';

import { useBackupData } from './useBackupData';

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
    getReportStatusLabel(record.status, record.status),
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

  const {
    files, dateFiles, selectedDate, selectedBackupPath, selectDate, selectBackup,
    records, selectedRecord, selectRecord: setSelectedRecord,
    loadingFiles, loadingRecords, filesError, recordsError, retryFiles, retryRecords,
    gcsNotConfigured, lastRun, lastRunStale, lastRunLoaded, lastRunLoading, lastRunError, retryLastRun,
    triggering, triggerBackup,
  } = useBackupData(wsLoading ? '' : currentOrg?.id ?? '');
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [helperFilter, setHelperFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  useEffect(() => {
    if (!wsLoading && currentOrg) {
      if (!checkManagementPermission(currentOrg.effectivePermissions, 'backupStatus')) {
        router.push('/app');
      }
    }
  }, [wsLoading, currentOrg, router]);

  const availableDates = uniqueOptions(files.map((file) => file.date)).sort((a, b) => b.localeCompare(a));
  const clientOptions = uniqueOptions(records.map((record) => record.clientName));
  const helperOptions = uniqueOptions(records.map((record) => record.helperName));

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
    <PageLayout>
      <InnerPageHeader
        icon={<BackupIcon />}
        title="バックアップ閲覧"
        actions={
          <AppButton
            size="small"
            onClick={() => void triggerBackup(showToast)}
            disabled={triggering}
            startIcon={triggering ? <CircularProgress size={14} color="inherit" /> : <BackupIcon fontSize="small" />}
          >
            {triggering ? 'バックアップ中...' : '今すぐバックアップ'}
          </AppButton>
        }
      />

      <PageContainer>
        <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
          {lastRunLoading && <Typography role="status" sx={{ mb: 2 }}>最終自動バックアップ実行情報を取得中...</Typography>}
          {lastRunError && (
            <Alert severity="error" sx={{ mb: 2 }} action={<AppButton intent="secondary" variant="text" onClick={() => void retryLastRun()}>再試行</AppButton>}>
              {lastRunError}
            </Alert>
          )}
          {lastRunLoaded && (
            !lastRun ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                自動バックアップの実行記録がありません。Vercelの環境変数（CRON_SECRET, GCP_PROJECT_ID, GCP_SERVICE_ACCOUNT_KEY_JSON等）とcronの実行状況を確認してください。
              </Alert>
            ) : (
              <Alert severity={lastRun.outcome === 'failure' ? 'error' : lastRunStale ? 'warning' : 'success'} sx={{ mb: 2 }}>
                最終自動バックアップ実行: {new Date(lastRun.createdAt).toLocaleString()}（{lastRun.outcome === 'success' ? '成功' : '失敗'}）
                {lastRunStale && '：最終実行から30時間以上経過しています。'}
              </Alert>
            )
          )}

          {gcsNotConfigured && (
            <Box sx={{ p: { xs: 2, sm: 3 }, mb: 2, borderTop: 1, borderBottom: 1, borderColor: 'warning.main' }}>
              <Stack spacing={1.5} alignItems="center" textAlign="center">
                <CloudOffIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                <Typography variant="h6" fontWeight="bold">GCS が設定されていません</Typography>
                <Typography variant="body2" color="text.secondary">
                  Vercel の環境変数に <code>GCP_PROJECT_ID</code> と <code>GCP_SERVICE_ACCOUNT_KEY_JSON</code> を設定してください。
                </Typography>
              </Stack>
            </Box>
          )}

          {filesError && (
            <Alert severity="error" sx={{ mb: 2 }} action={<AppButton intent="secondary" variant="text" onClick={() => void retryFiles()}>再試行</AppButton>}>
              {filesError}
            </Alert>
          )}
          {recordsError && (
            <Alert severity="error" sx={{ mb: 2 }} action={<AppButton intent="secondary" variant="text" onClick={() => void retryRecords()}>再試行</AppButton>}>
              {recordsError}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems={{ md: 'flex-start' }}>
            <Box
              sx={{
                width: { xs: '100%', md: 200 },
                flexShrink: 0,
                overflow: 'hidden',
                borderTop: 1,
                borderBottom: 1,
                borderColor: 'divider',
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
                      selectDate(event.target.value);
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
                    onChange={(event) => selectBackup(event.target.value)}
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
            </Box>

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
                <SelectField
                  label="ステータス"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: '', label: 'すべて' },
                    ...['approved', 'pending', 'draft', 'remanded'].map((value) => ({ value, label: getReportStatusLabel(value) })),
                  ]}
                />
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: { xs: 'right', lg: 'left' }, whiteSpace: 'nowrap' }}>
                  {loadingRecords ? '読み込み中...' : `${filtered.length} 件 / 全 ${records.length} 件`}
                </Typography>
              </Box>

              <DataTable
                rows={filtered}
                loading={loadingRecords}
                getRowKey={(record) => record.id}
                onRowClick={(record) => setSelectedRecord(record)}
                emptyTitle={records.length === 0 ? 'この日のバックアップに記録がありません' : '条件に一致する記録がありません'}
                minWidth={820}
                mobileCardRender={(record) => (
                  <Box sx={{ px: 1.5, bgcolor: 'background.paper' }}>
                    <Stack spacing={1.25}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{record.clientName}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{record.helperName}</Typography>
                        </Box>
                        <StatusChip
                          label={getReportStatusLabel(record.status, record.status)}
                          tone={getReportStatusChipColor(record.status)}
                        />
                      </Stack>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '4em minmax(0, 1fr)', gap: 0.75, color: 'text.secondary', fontSize: 13 }}>
                        <Box>開始</Box>
                        <Box>{formatDateTime(record.startAt)}</Box>
                        <Box>終了</Box>
                        <Box>{formatDateTime(record.endAt)}</Box>
                      </Box>
                    </Stack>
                  </Box>
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
                        label={getReportStatusLabel(record.status, record.status)}
                        tone={getReportStatusChipColor(record.status)}
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
            <Box sx={{ p: 2, bgcolor: 'background.subtle', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
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
                    label={getReportStatusLabel(selectedRecord.status, selectedRecord.status)}
                    tone={getReportStatusChipColor(selectedRecord.status)}
                  />
                </Box>
              </Box>
            </Box>

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
    </PageLayout>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

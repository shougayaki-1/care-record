'use client';

import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel, Tabs, TextField, Typography,
} from '@/components/ui/mui';
import ListAltIcon from '@mui/icons-material/ListAlt';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import { InnerPageHeader, PageBody, PageLayout, PageSection, TablePageSkeleton } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { exportAuditLogsCsv, getAuditLogs, listCloudLogEntries, type CloudLogEntry } from '@/app/actions/organization';
import { checkManagementPermission } from '@/utils/permissions';

type AuditLog = {
  id: string;
  created_at: string;
  action_type: string;
  resource_id: string | null;
  resource_type?: string | null;
  outcome?: string | null;
  profiles: { name: string } | null;
};

type AuditSortColumn = 'created_at' | 'actor' | 'action_type' | 'resource' | 'outcome';

function formatTokyoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function todayInTokyo(): string {
  return formatTokyoDate(new Date());
}

function daysAgoInTokyo(days: number): string {
  return formatTokyoDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

export default function LogsPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const [tab, setTab] = useState<'audit' | 'cloud'>('audit');

  // 監査ログ(Supabase)は実質的に本日分しか残らないため、初期値は「本日」に固定。ピッカー自体は残し、必要なら過去日にも変更可能にする。
  const [auditFrom, setAuditFrom] = useState(() => todayInTokyo());
  const [auditTo, setAuditTo] = useState(() => todayInTokyo());
  // GCPログはCloud Loggingの反映遅延があるため、初期値は「昨日以前」（昨日〜7日前）にする。
  const [cloudFrom, setCloudFrom] = useState(() => daysAgoInTokyo(7));
  const [cloudTo, setCloudTo] = useState(() => daysAgoInTokyo(1));
  const [cloudText, setCloudText] = useState('');

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cloudLogs, setCloudLogs] = useState<CloudLogEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [auditOrder, setAuditOrder] = useState<'asc' | 'desc'>('desc');
  const [auditOrderBy, setAuditOrderBy] = useState<AuditSortColumn>('created_at');

  const canView = Boolean(currentOrg && checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs'));

  const fetchAudit = async () => {
    if (!currentOrg || !canView) return;
    setMessage(null);
    try {
      const data = await getAuditLogs(currentOrg.id, {
        from: auditFrom ? new Date(`${auditFrom}T00:00:00+09:00`).toISOString() : null,
        to: auditTo ? new Date(`${auditTo}T23:59:59+09:00`).toISOString() : null,
      });
      setAuditLogs((data as unknown as AuditLog[]) || []);
    } catch (e) {
      console.error(e);
      setMessage(e instanceof Error ? e.message : '監査ログを取得できませんでした');
    }
  };

  const fetchCloud = async () => {
    if (!currentOrg || !canView) return;
    setMessage(null);
    try {
      const data = await listCloudLogEntries(currentOrg.id, {
        from: cloudFrom ? new Date(`${cloudFrom}T00:00:00+09:00`).toISOString() : null,
        to: cloudTo ? new Date(`${cloudTo}T23:59:59+09:00`).toISOString() : null,
        text: cloudText || null,
      });
      setCloudLogs(data);
    } catch (e) {
      console.error(e);
      setMessage(e instanceof Error ? e.message : 'GCPログを取得できませんでした');
    }
  };

  const fetchActiveTab = useEffectEvent(() => {
    if (tab === 'audit') return fetchAudit();
    return fetchCloud();
  });

  // タブが開かれたタイミングで自動的に絞り込みボタンを押した状態にする(手動クリック不要)
  useEffect(() => {
    if (!currentOrg || !canView) return;
    queueMicrotask(() => void fetchActiveTab());
  }, [tab, currentOrg, canView]);

  const handleExport = async () => {
    if (!currentOrg) return;
    const { filename, csv } = await exportAuditLogsCsv(currentOrg.id, {
      from: auditFrom ? new Date(`${auditFrom}T00:00:00+09:00`).toISOString() : null,
      to: auditTo ? new Date(`${auditTo}T23:59:59+09:00`).toISOString() : null,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAuditSort = (column: AuditSortColumn) => {
    if (auditOrderBy === column) {
      setAuditOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setAuditOrderBy(column);
      setAuditOrder('asc');
    }
  };

  const sortedAuditLogs = useMemo(() => {
    const getValue = (log: AuditLog): string => {
      switch (auditOrderBy) {
        case 'actor': return log.profiles?.name || '不明';
        case 'action_type': return log.action_type || '';
        case 'resource': return `${log.resource_type || ''}/${log.resource_id || ''}`;
        case 'outcome': return log.outcome || 'success';
        default: return log.created_at;
      }
    };
    const sorted = [...auditLogs].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return auditOrder === 'asc' ? sorted : sorted.reverse();
  }, [auditLogs, auditOrder, auditOrderBy]);

  if (wsLoading || !currentOrg) return <TablePageSkeleton />;
  if (!canView) return <Box p={3}><Alert severity="warning">操作ログを閲覧する権限がありません。</Alert></Box>;

  return (
    <PageLayout>
      <InnerPageHeader icon={<ListAltIcon />} title="ログ" />
      <PageBody>
        <Stack spacing={2}>
          {message && <Alert severity="error">{message}</Alert>}
          <PageSection sx={{ py: 0 }}>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile>
              <Tab value="audit" label="監査ログ" icon={<ListAltIcon fontSize="small" />} iconPosition="start" />
              <Tab value="cloud" label="GCPログ" icon={<CloudQueueIcon fontSize="small" />} iconPosition="start" />
            </Tabs>
            <Divider />
            {tab === 'audit' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ p: 2 }}>
                <TextField label="開始日" type="date" size="small" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField label="終了日" type="date" size="small" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <Button variant="outlined" onClick={fetchAudit}>絞り込み</Button>
                <Box sx={{ flexGrow: 1 }} />
                <Button variant="contained" onClick={handleExport}>CSVエクスポート</Button>
              </Stack>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ p: 2 }}>
                <TextField label="開始日" type="date" size="small" value={cloudFrom} onChange={(e) => setCloudFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField label="終了日" type="date" size="small" value={cloudTo} onChange={(e) => setCloudTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField label="検索語" size="small" value={cloudText} onChange={(e) => setCloudText(e.target.value)} />
                <Button variant="outlined" onClick={fetchCloud}>絞り込み</Button>
              </Stack>
            )}
            <Divider />
            {tab === 'audit' ? (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sortDirection={auditOrderBy === 'created_at' ? auditOrder : false}>
                      <TableSortLabel active={auditOrderBy === 'created_at'} direction={auditOrderBy === 'created_at' ? auditOrder : 'asc'} onClick={() => handleAuditSort('created_at')}>日時</TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={auditOrderBy === 'actor' ? auditOrder : false}>
                      <TableSortLabel active={auditOrderBy === 'actor'} direction={auditOrderBy === 'actor' ? auditOrder : 'asc'} onClick={() => handleAuditSort('actor')}>操作者</TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={auditOrderBy === 'action_type' ? auditOrder : false}>
                      <TableSortLabel active={auditOrderBy === 'action_type'} direction={auditOrderBy === 'action_type' ? auditOrder : 'asc'} onClick={() => handleAuditSort('action_type')}>操作内容</TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={auditOrderBy === 'resource' ? auditOrder : false}>
                      <TableSortLabel active={auditOrderBy === 'resource'} direction={auditOrderBy === 'resource' ? auditOrder : 'asc'} onClick={() => handleAuditSort('resource')}>対象</TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={auditOrderBy === 'outcome' ? auditOrder : false}>
                      <TableSortLabel active={auditOrderBy === 'outcome'} direction={auditOrderBy === 'outcome' ? auditOrder : 'asc'} onClick={() => handleAuditSort('outcome')}>結果</TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedAuditLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} align="center">ログはありません</TableCell></TableRow>
                  ) : sortedAuditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                      <TableCell>{log.profiles?.name || '不明'}</TableCell>
                      <TableCell>{log.action_type}</TableCell>
                      <TableCell>{log.resource_type || '-'} / {log.resource_id || '-'}</TableCell>
                      <TableCell><Chip label={log.outcome || 'success'} size="small" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>日時</TableCell>
                    <TableCell>重大度</TableCell>
                    <TableCell>ログ</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cloudLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={3} align="center">GCPログはありません</TableCell></TableRow>
                  ) : cloudLogs.map((log, index) => (
                    <TableRow key={`${log.timestamp}-${index}`}>
                      <TableCell>{log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}</TableCell>
                      <TableCell><Chip label={log.severity} size="small" /></TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {log.text || log.logName}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageSection>
        </Stack>
      </PageBody>
    </PageLayout>
  );
}

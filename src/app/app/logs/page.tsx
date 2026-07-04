'use client';

import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography,
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

export default function LogsPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const [tab, setTab] = useState<'audit' | 'cloud'>('audit');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cloudText, setCloudText] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [cloudLogs, setCloudLogs] = useState<CloudLogEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const canView = Boolean(currentOrg && checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs'));

  const getFilterDates = () => ({
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(to).toISOString() : null,
  });

  const fetchAudit = async () => {
    if (!currentOrg || !canView) return;
    setMessage(null);
    try {
      const data = await getAuditLogs(currentOrg.id, getFilterDates());
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
      setCloudLogs(await listCloudLogEntries(currentOrg.id, { ...getFilterDates(), text: cloudText || null }));
    } catch (e) {
      console.error(e);
      setMessage(e instanceof Error ? e.message : 'GCPログを取得できませんでした');
    }
  };

  const handleExport = async () => {
    if (!currentOrg) return;
    const { filename, csv } = await exportAuditLogsCsv(currentOrg.id, getFilterDates());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ p: 2 }}>
              <TextField label="開始日" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="終了日" type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              {tab === 'cloud' && <TextField label="検索語" size="small" value={cloudText} onChange={(e) => setCloudText(e.target.value)} />}
              <Button variant="outlined" onClick={tab === 'audit' ? fetchAudit : fetchCloud}>絞り込み</Button>
              <Box sx={{ flexGrow: 1 }} />
              {tab === 'audit' && <Button variant="contained" onClick={handleExport}>CSVエクスポート</Button>}
            </Stack>
            <Divider />
            {tab === 'audit' ? (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>日時</TableCell>
                    <TableCell>操作者</TableCell>
                    <TableCell>操作内容</TableCell>
                    <TableCell>対象</TableCell>
                    <TableCell>結果</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} align="center">ログはありません</TableCell></TableRow>
                  ) : auditLogs.map((log) => (
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

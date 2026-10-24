'use client';
import { getActionErrorMessage, needsActionRecovery, readActionResult } from '@/utils/actionResult';

import { RecoveryLogoutButton } from '@/components/auth/RecoveryLogoutButton';
import { useRecordQuery } from '@/hooks/useRecordQuery';
import { commitRecordChange } from '@/utils/recordFeedUpdates';
import { useState, useCallback } from 'react';
import {
  Box, Typography, Button, CircularProgress, Stack, TextField, MenuItem,
  Switch, FormControlLabel, LinearProgress, Alert
} from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import TagIcon from '@mui/icons-material/Tag';
import ArticleIcon from '@mui/icons-material/Article';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import SettingsIcon from '@mui/icons-material/Settings';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { softDeleteReports, transitionReports } from '@/app/actions/reports';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, InnerPageHeader, PageBody, PageLayout, TablePageSkeleton } from '@/components/ui';
import { checkManagementPermission, checkRecordPermission } from '@/utils/permissions';
import { buildRecordPath } from '@/utils/recordNavigation';
import { getReportStatusChipColor, getReportStatusLabel } from '@/utils/reportStatus';
import { useReportExport } from '@/hooks/useReportExport';
import type { Report } from '@/utils/reportExportData';
import { useReportFilters } from '@/hooks/useReportFilters';
import { RecordListFilterBar } from '@/components/record/RecordListFilterBar';
import { RecordListTable, type RecordListRow } from '@/components/record/RecordListTable';

type ClientData = { id: string; name: string };

const REPORT_PAGE_SIZE = 50;

function getHelperNames(report: Report): string {
  const values = Array.isArray(report.report_values) ? report.report_values[0] : report.report_values;
  const helpers = values?.helpers;
  if (Array.isArray(helpers) && helpers.length > 0) return helpers.join(', ');
  return report.helper?.name || '不明';
}

const EMPTY_CLIENTS: ClientData[] = [];
const EMPTY_REPORTS: { reports: Report[]; aiSentCount: number } = { reports: [], aiSentCount: 0 };
const logReportError = (error: unknown) => console.error(error);

export default function ReportsClientPage() {
  const router = useRouter();
  const { currentOrg, userId, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  
  const [page, setPage] = useState(0);
  const loadClients = useCallback(async () => {
    if (!currentOrg) return EMPTY_CLIENTS;
    const { data, error } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).is('deleted_at', null);
    if (error) throw error;
    return (data as ClientData[]) || EMPTY_CLIENTS;
  }, [currentOrg]);
  const { data: clients, loading: clientsLoading, error: clientsError, refresh: fetchClients } = useRecordQuery({
    organizationId: wsLoading ? undefined : currentOrg?.id,
    queryKey: `report-clients/${userId}`, load: loadClients, empty: EMPTY_CLIENTS, onError: logReportError,
  });

  const {
    filterClientId,
    setFilterClientId,
    filterStatus,
    setFilterStatus,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    onlyPending,
    setOnlyPending,
    filterShiftId,
    order,
    setOrder,
    orderBy,
    setOrderBy,
    isCurrentMonth,
    isExportView,
    ready: filtersReady,
    resetFilters,
  } = useReportFilters({ userId, organizationId: wsLoading ? undefined : currentOrg?.id, clients: clientsError != null || (clientsLoading && clients === EMPTY_CLIENTS) ? undefined : clients });
  const [selected, setSelected] = useState<readonly string[]>([]);
  
  const [processing, setProcessing] = useState(false);

  const loadReports = useCallback(async () => {
    if (!currentOrg) return EMPTY_REPORTS;
    setSelected([]);
    try {
      let reportIdsFromShift: string[] | null = null;
      if (filterShiftId) {
        const { data: shiftLinks } = await supabase
          .from('report_shifts')
          .select('report_id')
          .eq('shift_id', filterShiftId);
        reportIdsFromShift = (shiftLinks ?? []).map(r => r.report_id);
      }

      let query = supabase.from('reports').select(`
          id, start_at, end_at, created_at, updated_at, status, approved_at, segment_id,
          clients!inner ( id, name, organization_id ),
          helper:profiles!reports_helper_id_fkey ( name ),
          approved_by_user:profiles!reports_approved_by_fkey ( name ),
          report_values ( helpers: data->_helpers ),
          segment:shift_segments ( service_type:service_types ( name ) )
        `).eq('clients.organization_id', currentOrg.id).is('deleted_at', null).neq('status', 'draft');

      if (reportIdsFromShift !== null) query = query.in('id', reportIdsFromShift.length > 0 ? reportIdsFromShift : ['']);
      if (filterClientId !== 'all') query = query.eq('client_id', filterClientId);
      if (startDate) query = query.gte('start_at', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('end_at', `${endDate}T23:59:59`);
      if (onlyPending) query = query.in('status', ['pending', 'remanded']);
      else if (filterStatus !== 'all') query = query.eq('status', filterStatus);

      query = query.order('start_at', { ascending: orderBy === 'start_at' && order === 'asc' }).order('id').limit(500);
      const { data, error } = await query;
      if (error) throw error;
      const sortedData = (data as unknown) as Report[] || [];
      sortedData.sort((a, b) => {
          const valA = orderBy === 'start_at' ? a.start_at : (orderBy === 'client_name' ? a.clients.name : '');
          const valB = orderBy === 'start_at' ? b.start_at : (orderBy === 'client_name' ? b.clients.name : '');
          if (valA < valB) return order === 'asc' ? -1 : 1;
          if (valA > valB) return order === 'asc' ? 1 : -1;
          return a.id.localeCompare(b.id);
      });
      setPage(0);
      const { count, error: countError } = await supabase.from('ai_import_candidates').select('id', { count: 'exact', head: true }).eq('organization_id', currentOrg.id);
      if (countError) throw countError;
      return { reports: sortedData, aiSentCount: count ?? 0 };
    } catch (e) { throw e; }
  }, [currentOrg, filterClientId, filterStatus, startDate, endDate, onlyPending, orderBy, order, filterShiftId]);

  const { data: { reports, aiSentCount }, loading, error: loadError, refresh: fetchReports } = useRecordQuery({ organizationId: wsLoading || !filtersReady ? undefined : currentOrg?.id, queryKey: `${filterClientId}/${filterStatus}/${startDate}/${endDate}/${onlyPending}/${orderBy}/${order}/${filterShiftId}`, load: loadReports, empty: EMPTY_REPORTS, onError: logReportError });

  const { exporting, gasProgress, handleExportCSV, handleExportTravelCosts, handleBulkDownloadPDF, handleCreateGasPdf } = useReportExport({ organizationId: currentOrg?.id, reports, selected, filterShiftId });

  const pageCount = Math.max(1, Math.ceil(reports.length / REPORT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleReports = reports.slice(currentPage * REPORT_PAGE_SIZE, (currentPage + 1) * REPORT_PAGE_SIZE);

  const handleSelectAllClick = (checked: boolean) => { if (checked) { setSelected(reports.map(n => n.id)); return; } setSelected([]); };
  const handleClick = (id: string) => {
      const selectedIndex = selected.indexOf(id);
      let newSelected: readonly string[] = [];
      if (selectedIndex === -1) newSelected = newSelected.concat(selected, id);
      else if (selectedIndex === 0) newSelected = newSelected.concat(selected.slice(1));
      else if (selectedIndex === selected.length - 1) newSelected = newSelected.concat(selected.slice(0, -1));
      else if (selectedIndex > 0) newSelected = newSelected.concat(selected.slice(0, selectedIndex), selected.slice(selectedIndex + 1));
      setSelected(newSelected);
  };

  const handleBulkApprove = async () => {
      if (selected.length === 0) return;
      if (!(await confirm({ message: `${selected.length}件を一括承認しますか？`, confirmText: '承認する' }))) return;
      setProcessing(true);
      try {
        await commitRecordChange(currentOrg!.id, () => readActionResult(transitionReports(currentOrg!.id, [...selected], 'approve')));
        setSelected([]);
        showToast('一括承認しました');
      } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); } finally { setProcessing(false); }
  };

  const handleBulkRemand = async () => {
    if (selected.length === 0) return;
    if (!(await confirm({ message: `${selected.length}件を一括で差戻ししますか？`, confirmText: '差し戻す' }))) return;
    setProcessing(true);
    try {
        await commitRecordChange(currentOrg!.id, () => readActionResult(transitionReports(currentOrg!.id, [...selected], 'remand')));
        setSelected([]);
        showToast('差し戻しました');
    } catch (e) { 
        console.error(e);
        showToast('エラーが発生しました', 'error'); 
    } finally { setProcessing(false); }
  };

  const handleBulkDelete = async () => {
    if (selected.length === 0) return;

    const targets = reports.filter(r => selected.includes(r.id));
    if (targets.some(r => r.status === 'approved')) {
        showToast('選択項目の中に「承認済み」の記録が含まれています。承認を取り消してから削除してください。', 'warning');
        return;
    }

    if (!(await confirm({ message: `${selected.length}件を削除しますか？\nこの操作は取り消せません。`, confirmText: '削除する', confirmColor: 'error' }))) return;

    setProcessing(true);
    try {
        await commitRecordChange(currentOrg!.id, () => readActionResult(softDeleteReports(currentOrg!.id, [...selected], '帳票一覧から削除')));
        setSelected([]);
        showToast('削除しました');
    } catch (e) { 
        console.error(e);
        showToast('エラーが発生しました', 'error'); 
    } finally { setProcessing(false); }
  };

  const formatReportDateTime = (d: Date) => {
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const isAbnormalReport = (report: Report) => {
      const start = new Date(report.start_at);
      const end = new Date(report.end_at);
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      return durationHours > 24 || durationHours < 0;
  };

  const handleOpenDetail = (report: Report) => { router.push(buildRecordPath(report.clients.id, { reportId: report.id })); };
  const listRows: RecordListRow[] = visibleReports.map((report) => {
    const abnormal = isAbnormalReport(report);
    return {
      id: report.id,
      status: getReportStatusLabel(report.status),
      statusColor: getReportStatusChipColor(report.status),
      start: formatReportDateTime(new Date(report.start_at)),
      end: formatReportDateTime(new Date(report.end_at)),
      client: report.clients.name,
      helper: getHelperNames(report),
      abnormal,
      actions: <Button size="small" variant={abnormal ? 'contained' : 'outlined'} color={abnormal ? 'error' : 'primary'} onClick={() => handleOpenDetail(report)} sx={{ fontSize: '0.75rem', py: 0.5 }}>{abnormal ? '確認・修正' : '詳細'}</Button>,
    };
  });
  let headerTitle = "全件表示";
  if (onlyPending) headerTitle = "未承認・差戻し";
  if (isCurrentMonth) headerTitle = "今月の記録";
  if (filterShiftId) headerTitle = "シフト内の記録";
  if (isExportView) headerTitle = "帳票・出力";

  if (clientsError != null) return <PageLayout><PageBody><Alert severity="error" action={needsActionRecovery(clientsError) ? <RecoveryLogoutButton /> : <AppButton intent="secondary" onClick={() => void fetchClients()}>再試行</AppButton>}>{getActionErrorMessage(clientsError, '利用者の読み込みに失敗しました')}</Alert></PageBody></PageLayout>;
  if (loadError != null) return <PageLayout><PageBody><Alert severity="error" action={needsActionRecovery(loadError) ? <RecoveryLogoutButton /> : <Button onClick={() => void fetchReports()}>再試行</Button>}>{getActionErrorMessage(loadError, '記録の読み込みに失敗しました')}</Alert></PageBody></PageLayout>;
  if (wsLoading || !currentOrg || !filtersReady) return <TablePageSkeleton />;
  const canApproveRecords = checkRecordPermission(currentOrg.effectivePermissions, 'approve', true);
  const canDeleteRecords = checkRecordPermission(currentOrg.effectivePermissions, 'delete', true);

  return (
    <PageLayout>
        <InnerPageHeader icon={<TagIcon />} title={headerTitle} actions={isExportView && checkManagementPermission(currentOrg.effectivePermissions, 'integrations') ? <Button size="small" startIcon={<SettingsIcon />} onClick={() => router.push('/app/settings?tab=google')}>出力先の設定</Button> : undefined} />

       <PageBody maxWidth={false}>
           {!isExportView && <AppButton intent="secondary" variant="outlined" sx={{ mb: 2 }} onClick={() => router.push('/app/reports/deletion-requests')}>削除申請を確認</AppButton>}
           {!isExportView && aiSentCount > 0 && <Alert severity="warning" sx={{ mb: 2 }} action={
             <Button color="inherit" size="small" onClick={() => router.push('/app/ai-candidates')}>確認する</Button>
           }>
             AIから送信された記録が {aiSentCount} 件、管理者の確認を待っています。
           </Alert>}
           {reports.length >= 500 && (
             <Alert severity="info" sx={{ mb: 2 }}>
               最初の500件を表示しています。日付や利用者で絞り込んでください。
             </Alert>
           )}

           <RecordListFilterBar source="reports" canViewReports>
                    <TextField select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: { xs: 0, md: 150 }, bgcolor: 'background.paper', width: { xs: '100%', md: 'auto' } }}>
                        <MenuItem value="all">全員</MenuItem>
                        {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                    </TextField>
                    <TextField select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: { xs: 0, md: 120 }, bgcolor: 'background.paper', width: { xs: '100%', md: 'auto' } }}>
                        <MenuItem value="all">全て</MenuItem><MenuItem value="pending">{getReportStatusLabel('pending')}</MenuItem><MenuItem value="approved">{getReportStatusLabel('approved')}</MenuItem><MenuItem value="remanded">{getReportStatusLabel('remanded')}</MenuItem>
                    </TextField>
                    <Box display="flex" alignItems="center" gap={1} sx={{ flexDirection: { xs: 'column', sm: 'row' }, width: { xs: '100%', md: 'auto' } }}>
                        <TextField type="date" label="開始日" size="small" slotProps={{ inputLabel: { shrink: true } }} value={startDate} onChange={(e) => setStartDate(e.target.value)} sx={{ bgcolor: 'background.paper', width: { xs: '100%', sm: 'auto' } }} />
                        <Typography sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                        <TextField type="date" label="終了日" size="small" slotProps={{ inputLabel: { shrink: true } }} value={endDate} onChange={(e) => setEndDate(e.target.value)} sx={{ bgcolor: 'background.paper', width: { xs: '100%', sm: 'auto' } }} />
                    </Box>
                    {!isExportView && <FormControlLabel control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />} label="未承認・差戻しのみ" />}
                    <Button variant="contained" startIcon={<SearchIcon />} onClick={fetchReports} sx={{ px: 3, boxShadow: 'none', width: { xs: '100%', md: 'auto' } }}>検索</Button>
                    <AppButton intent="secondary" variant="text" onClick={resetFilters}>絞り込みをリセット</AppButton>
           </RecordListFilterBar>
           
           <Box sx={{ p: 2, mb: 2, bgcolor: selected.length > 0 ? 'background.tint' : 'background.paper', display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
               <Box>
                   <Typography variant="body1" fontWeight="bold">
                       {selected.length > 0 ? `${selected.length} 件選択中` : `検索結果: ${reports.length} 件`}
                   </Typography>
               </Box>
               <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                 {isExportView && <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={processing || exporting}>CSV</Button>}
                 {isExportView && <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportTravelCosts} disabled={processing || exporting}>交通費精算CSV</Button>}
                 {isExportView && <Button variant="outlined" size="small" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleBulkDownloadPDF} disabled={processing || exporting}>PDF</Button>}
                 {selected.length > 0 ? (
                    <>
                        {isExportView && <Button variant="contained" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={processing || exporting}>
                            {gasProgress ? '作成中...' : '帳票作成(GAS)'}
                        </Button>}
                        {!isExportView && canApproveRecords && <Button variant="contained" size="small" startIcon={<CheckCircleIcon />} onClick={handleBulkApprove} disabled={processing || exporting} sx={{ boxShadow: 'none' }}>一括承認</Button>}
                        {!isExportView && canApproveRecords && <Button variant="contained" size="small" color="warning" startIcon={<RestoreIcon />} onClick={handleBulkRemand} disabled={processing || exporting}>一括差戻し</Button>}
                        {!isExportView && canDeleteRecords && <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />} onClick={handleBulkDelete} disabled={processing || exporting}>削除</Button>}
                    </>
                 ) : isExportView ? (
                     <Button variant="outlined" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={processing || exporting}>
                        {gasProgress ? '作成中...' : '全件帳票作成'}
                     </Button>
                 ) : null}
               </Stack>
           </Box>

           {gasProgress && (
               <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'background.paper', p: 2, borderRadius: 2, boxShadow: 3, zIndex: 9999 }}>
                   <Typography variant="body2" fontWeight="bold">帳票作成中...</Typography>
                   <Typography variant="caption" display="block" sx={{ mb: 1 }}>{gasProgress.currentName}</Typography>
                   <LinearProgress variant="determinate" value={(gasProgress.current / gasProgress.total) * 100} sx={{ width: { xs: 'calc(100vw - 72px)', sm: 250 } }} />
                   <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>{gasProgress.current} / {gasProgress.total}</Typography>
               </Box>
           )}

           {loading ? <CircularProgress /> : (
             <>
             <RecordListTable
               rows={listRows}
               selectedIds={selected}
               onToggle={handleClick}
               onSelectAll={handleSelectAllClick}
               sort={{ order, active: orderBy === 'start_at', onChange: () => { setOrder(order === 'asc' ? 'desc' : 'asc'); setOrderBy('start_at'); } }}
             />
             {pageCount > 1 && (
               <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mt: 2 }}>
                 <Button variant="outlined" size="small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</Button>
                 <Typography variant="body2">{currentPage + 1} / {pageCount} ページ</Typography>
                 <Button variant="outlined" size="small" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>次へ</Button>
               </Stack>
             )}
             </>
           )}
       </PageBody>
    </PageLayout>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button,
  CircularProgress, Stack, TextField, MenuItem, Checkbox, TableSortLabel, Switch, FormControlLabel, Divider,
  LinearProgress, Tooltip, Alert
} from '@/components/ui/mui';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import TagIcon from '@mui/icons-material/Tag';
import ArticleIcon from '@mui/icons-material/Article';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import SettingsIcon from '@mui/icons-material/Settings';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'; // ★追加: 警告アイコン
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { supabase } from '@/lib/supabase';
import type { PdfReportData } from '@/components/pdf/ServiceRecordDocument';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { auditReportExport, softDeleteReports, transitionReports } from '@/app/actions/reports';
import { updateClientGoogleLink } from '@/app/actions/clients';
import { generateKeyMap, FormItem as HelperFormItem, FormValue } from '@/utils/templateHelper';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { InnerPageHeader, PageBody, PageLayout, TablePageSkeleton } from '@/components/ui';
import { checkManagementPermission, checkRecordPermission } from '@/utils/permissions';
import { buildRecordPath } from '@/utils/recordNavigation';
import { getReportStatusChipColor, getReportStatusLabel, type ReportStatus } from '@/utils/reportStatus';
import {
  buildReportsCsv,
  buildTravelSettlementCsv,
  getReportData,
  getReportHelperNames as getHelperNames,
} from '@/utils/reportsExport';
import { useReportFilters } from '@/hooks/useReportFilters';

type ReportValuesData = Record<string, FormValue>;

type Report = {
  id: string; start_at: string; end_at: string; created_at: string; updated_at: string; status: ReportStatus; approved_at: string | null;
  segment_id: string | null;
  segment?: { service_type: { name: string } | null } | null;
  clients: { id: string; name: string; organization_id: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { data: ReportValuesData } | { data: ReportValuesData }[];
};
type ClientData = { id: string; name: string };

export default function ReportsClientPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [reports, setReports] = useState<Report[]>([]);
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);

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
  } = useReportFilters();
  const [selected, setSelected] = useState<readonly string[]>([]);
  
  const [processing, setProcessing] = useState(false);
  const [gasProgress, setGasProgress] = useState<{ total: number, current: number, currentName: string } | null>(null);

  const fetchClients = useCallback(async () => {
    if (!currentOrg) return;
    const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
    setClients((data as ClientData[]) || []);
  }, [currentOrg]);

  const fetchReports = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true); setSelected([]);
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
          *, clients!inner ( id, name, organization_id ),
          helper:profiles!reports_helper_id_fkey ( name ),
          approved_by_user:profiles!reports_approved_by_fkey ( name ),
          report_values ( data ),
          segment:shift_segments ( service_type:service_types ( name ) )
        `).eq('clients.organization_id', currentOrg.id).is('deleted_at', null).neq('status', 'draft');

      if (reportIdsFromShift !== null) query = query.in('id', reportIdsFromShift.length > 0 ? reportIdsFromShift : ['']);
      if (filterClientId !== 'all') query = query.eq('client_id', filterClientId);
      if (startDate) query = query.gte('start_at', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('end_at', `${endDate}T23:59:59`);
      if (onlyPending) query = query.in('status', ['pending', 'remanded']);
      else if (filterStatus !== 'all') query = query.eq('status', filterStatus);

      query = query.limit(500);
      const { data, error } = await query;
      if (error) throw error;
      const sortedData = (data as unknown) as Report[] || [];
      sortedData.sort((a, b) => {
          const valA = orderBy === 'start_at' ? a.start_at : (orderBy === 'client_name' ? a.clients.name : '');
          const valB = orderBy === 'start_at' ? b.start_at : (orderBy === 'client_name' ? b.clients.name : '');
          if (valA < valB) return order === 'asc' ? -1 : 1;
          if (valA > valB) return order === 'asc' ? 1 : -1;
          return 0;
      });
      setReports(sortedData);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [currentOrg, filterClientId, filterStatus, startDate, endDate, onlyPending, orderBy, order, filterShiftId]);

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Workspace/filter changes are the external data source for this page.
      fetchClients();
      fetchReports();
    }
  }, [wsLoading, currentOrg, fetchClients, fetchReports]);

  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>) => { if (event.target.checked) { setSelected(reports.map(n => n.id)); return; } setSelected([]); };
  const handleClick = (event: React.MouseEvent<unknown>, id: string) => {
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
        const updateData = { status: 'approved' as ReportStatus, approved_at: new Date().toISOString() };
        await transitionReports(currentOrg!.id, [...selected], 'approve');
        setReports(prev => prev.map(r => selected.includes(r.id) ? { ...r, ...updateData, approved_by_user: { name: 'あなた' } } : r));
        setSelected([]);
        showToast('一括承認しました');
      } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); } finally { setProcessing(false); }
  };

  const handleBulkRemand = async () => {
    if (selected.length === 0) return;
    if (!(await confirm({ message: `${selected.length}件を一括で差戻ししますか？`, confirmText: '差し戻す' }))) return;
    setProcessing(true);
    try {
        await transitionReports(currentOrg!.id, [...selected], 'remand');
        setReports(prev => prev.map(r => selected.includes(r.id) ? { ...r, status: 'remanded' as ReportStatus } : r));
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
        await softDeleteReports(currentOrg!.id, [...selected], '帳票一覧から削除');
        setReports(prev => prev.filter(r => !selected.includes(r.id)));
        setSelected([]);
        showToast('削除しました');
    } catch (e) { 
        console.error(e);
        showToast('エラーが発生しました', 'error'); 
    } finally { setProcessing(false); }
  };

  const getTargetReports = () => selected.length > 0 ? reports.filter(r => selected.includes(r.id)) : reports;

  const formatReportDateTime = (d: Date) => {
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const isAbnormalReport = (report: Report) => {
      const start = new Date(report.start_at);
      const end = new Date(report.end_at);
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      return durationHours > 24 || durationHours < 0;
  };

  const handleExportCSV = async () => {
      const targetReports = getTargetReports();
      if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }
      if (!(await confirm({ message: `${targetReports.length}件のデータをエクスポートします。\n差し込み印刷用に全ての項目を列に展開します。よろしいですか？` }))) return;
      setProcessing(true);
      try {
        await auditReportExport(currentOrg!.id, targetReports.map((report) => report.id), 'csv');
        const clientIds = Array.from(new Set(targetReports.map(r => r.clients.id)));
        const { data: templates } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);

        const csvContent = buildReportsCsv(
          targetReports,
          (templates ?? []).map((template) => ({
            schema: template.schema as HelperFormItem[] | null,
          })),
        );
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `reports_export_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) { console.error(e); showToast('エクスポート中にエラーが発生しました', 'error'); } finally { setProcessing(false); }
  };

  const handleExportTravelCosts = async () => {
      const targetReports = getTargetReports();
      const { csv, missingCount, itemCount } = buildTravelSettlementCsv(targetReports);
      if (missingCount > 0) {
        showToast(`${missingCount}件の承認済み記録にスタッフ別交通費がありません。記録を確認してください。`, 'warning');
        return;
      }
      if (itemCount === 0) { showToast('出力できる承認済みの交通費がありません', 'warning'); return; }
      try {
        await auditReportExport(currentOrg!.id, targetReports.filter((report) => report.status === 'approved').map((report) => report.id), 'csv');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `travel_settlement_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        console.error(error);
        showToast('交通費の出力に失敗しました', 'error');
      }
  };

  const handleBulkDownloadPDF = async () => {
      const targetReports = getTargetReports();
      if (targetReports.length === 0) { showToast('出力するデータがありません', 'warning'); return; }
      const pdfConfirmMsg = targetReports.length > 50
        ? `${targetReports.length}件のPDFを作成します。\n時間がかかる場合があります。`
        : `${targetReports.length}件のPDFを出力しますか？`;
      if (!(await confirm({ message: pdfConfirmMsg }))) return;

      try {
        await auditReportExport(currentOrg!.id, targetReports.map((report) => report.id), 'pdf');
        const pdfReports = await Promise.all(targetReports.map(async (report) => {
          const data = getReportData(report);
          if (!data) return null;
          const { data: tmplData } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
          
          const pdfData: PdfReportData = {
            id: report.id, 
            clientName: report.clients.name, 
            helperName: getHelperNames(report),
            startAt: report.start_at, endAt: report.end_at, 
            data: data, 
            template: (tmplData?.schema as HelperFormItem[]) || []
          };
          return pdfData;
        }));
        
        const validReports = pdfReports.filter((r): r is PdfReportData => r !== null);

        if (filterShiftId) {
          const { downloadReportZip, buildReportFileName } = await import('@/utils/reportZipExport');
          const entries = targetReports
            .map((report, i) => {
              const pdfData = validReports[i];
              if (!pdfData) return null;
              const serviceTypeName = report.segment?.service_type?.name ?? null;
              return {
                data: pdfData,
                fileName: buildReportFileName(report.clients.name, serviceTypeName, report.start_at, report.end_at),
              };
            })
            .filter((e): e is NonNullable<typeof e> => e !== null);
          const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          await downloadReportZip(entries, `サービス提供記録_${dateStr}`);
        } else {
          const [{ pdf }, { ServiceRecordDocument }] = await Promise.all([
            import('@react-pdf/renderer'),
            import('@/components/pdf/ServiceRecordDocument'),
          ]);
          const pdfDocument = <ServiceRecordDocument reports={validReports} /> as ReactElement<DocumentProps>;
          const blob = await pdf(pdfDocument).toBlob();
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `reports_${new Date().toISOString().slice(0,10)}.pdf`;
          link.click();
        }
      } catch (e) { console.error(e); showToast('PDF作成中にエラーが発生しました', 'error'); }
  };

  const preparePdfData = (
    rawData: ReportValuesData, 
    schema: HelperFormItem[], 
    keyMap: Record<string, string>
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    schema.forEach(item => {
        const labelKey = keyMap[item.id] || item.id;
        const val = rawData[item.id];
        if (item.type === 'checkbox') {
            result[labelKey] = !!val; 
            if (item.hasDetail) {
                const detailKey = `${labelKey}_詳細`;
                result[detailKey] = rawData[`${item.id}_detail`] || "";
            }
        } 
        else if (item.type === 'multicheckbox' || item.type === 'select') {
            const selectedValues: string[] = Array.isArray(val) ? val : (val ? [String(val)] : []);
            if (item.options) {
                item.options.split(',').forEach((opt: string) => {
                    const cleanOpt = opt.trim();
                    const optKey = `${labelKey}_${cleanOpt}`;
                    result[optKey] = selectedValues.includes(cleanOpt);
                });
            }
            if (item.hasDetail) {
                const detailKey = `${labelKey}_詳細`;
                result[detailKey] = rawData[`${item.id}_detail`] || "";
            }
        } 
        else {
            result[labelKey] = (val === null || val === undefined) ? "" : val;
        }
    });
    return result;
  };

  const handleCreateGasPdf = async () => {
      const targetReports = getTargetReports();
      if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }

      const clientGroups: Record<string, Report[]> = {};
      targetReports.forEach(r => {
          const cid = r.clients.id;
          if (!clientGroups[cid]) clientGroups[cid] = [];
          clientGroups[cid].push(r);
      });

      const clientIds = Object.keys(clientGroups);
      const { data: clientsInfo } = await supabase.from('clients').select('id, name, google_template_id, google_folder_id').in('id', clientIds);
      
      const { data: templates } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);

      const schemaMap: Record<string, HelperFormItem[]> = {};
      const keyMaps: Record<string, Record<string, string>> = {};

      templates?.forEach(t => { 
          const s = t.schema as HelperFormItem[];
          schemaMap[t.client_id] = s;
          keyMaps[t.client_id] = generateKeyMap(s);
      });

      const { data: orgInfo } = await supabase.from('organizations').select('google_folder_id').eq('id', currentOrg!.id).single();
      if (!orgInfo?.google_folder_id) { showToast('事業所のGoogleドライブ連携が設定されていません。設定画面から連携を行ってください。', 'warning'); return; }

      if (!(await confirm({ message: `${targetReports.length}件の帳票を作成しますか？\n（Googleドライブに保存されます）` }))) return;
      setGasProgress({ total: targetReports.length, current: 0, currentName: '準備中...' });

      let lastOpenedFolderUrl: string | null = null;

      try {
          let processedCount = 0;
          const now = new Date();
          const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
          const exportFolderName = `${timeStr}_出力分`;

          for (const client of clientsInfo || []) {
              const reports = clientGroups[client.id];
              if (!reports) continue;
              if (!client.google_template_id) {
                  processedCount += reports.length;
                  setGasProgress({ total: targetReports.length, current: processedCount, currentName: `${client.name}: テンプレート未設定のためスキップ` });
                  continue;
              }

              setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: フォルダ確認中...` }));
              
              const folderRes = await callGasApi({
                  action: 'manage_client_folder',
                  organizationId: currentOrg!.id,
                  clientId: client.id,
                  orgFolderId: orgInfo.google_folder_id,
                  clientName: client.name,
                  currentFolderId: client.google_folder_id
              });

              if (folderRes.status !== 'success') throw new Error(`Folder Error: ${folderRes.message}`);
              if (folderRes.folderId !== client.google_folder_id) {
                  await updateClientGoogleLink(currentOrg!.id, client.id, { folderId: folderRes.folderId });
              }
              const clientRootFolderId = folderRes.folderId;

              setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: サブフォルダ作成中...` }));
              const subFolderRes = await callGasApi({
                  action: 'create_sub_folder',
                  organizationId: currentOrg!.id,
                  clientId: client.id,
                  parentId: clientRootFolderId,
                  folderName: exportFolderName
              });
              const targetFolderId = subFolderRes.folderId; 
              lastOpenedFolderUrl = subFolderRes.folderUrl;

              const clientSchema = schemaMap[client.id] || [];
              const clientKeyMap = keyMaps[client.id] || {};

              for (const report of reports) {
                  setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: ${new Date(report.start_at).toLocaleDateString()} の記録を作成中...` }));
                  const data = getReportData(report) || {};
                  
                  const flatData: Record<string, string | number | boolean | null | undefined> = {};
                  
                  const start = new Date(report.start_at);
                  const end = new Date(report.end_at);
                  
                  flatData['利用者名'] = client.name;
                  flatData['担当ヘルパー名'] = getHelperNames(report);
                  flatData['開始日付'] = `${start.getFullYear()}/${start.getMonth()+1}/${start.getDate()}`;
                  flatData['開始時刻'] = `${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')}`;
                  flatData['終了日付'] = `${end.getFullYear()}/${end.getMonth()+1}/${end.getDate()}`;
                  flatData['終了時刻'] = `${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}`;
                  flatData['サービス時間'] = (data.service_time as string | number) || '0';
                  flatData['移動時間'] = (data.travel_time as string | number) || '0';

                  const readableData = preparePdfData(data, clientSchema, clientKeyMap);
                  const finalPayload = { ...flatData, ...readableData } as Record<string, unknown>;

                  await callGasApi({
                      action: 'create_pdf',
                      organizationId: currentOrg!.id,
                      clientId: client.id,
                      reportId: report.id,
                      folderId: targetFolderId, 
                      templateId: client.google_template_id,
                      data: finalPayload, 
                      fileName: `${client.name}_${(flatData['開始日付'] as string).replace(/\//g,'-')}_提供記録`
                  });
                  processedCount++;
                  setGasProgress({ total: targetReports.length, current: processedCount, currentName: '' });
              }
          }
          showToast('作成が完了しました。保存先のフォルダを開きます。');
          if (lastOpenedFolderUrl) window.open(lastOpenedFolderUrl, '_blank');

      } catch (e) { console.error(e); showToast('エラーが発生しました: ' + e, 'error'); }
      finally { setGasProgress(null); }
  };

  const handleOpenDetail = (report: Report) => { router.push(buildRecordPath(report.clients.id, { reportId: report.id })); };
  let headerTitle = "全件表示";
  if (onlyPending) headerTitle = "未承認・差戻し";
  if (isCurrentMonth) headerTitle = "今月の記録";
  if (filterShiftId) headerTitle = "シフト内の記録";
  if (isExportView) headerTitle = "帳票・出力";

  if (wsLoading || !currentOrg) return <TablePageSkeleton />;
  const canApproveRecords = checkRecordPermission(currentOrg.effectivePermissions, 'approve', true);
  const canDeleteRecords = checkRecordPermission(currentOrg.effectivePermissions, 'delete', true);

  return (
    <PageLayout>
        <InnerPageHeader icon={<TagIcon />} title={headerTitle} actions={isExportView && checkManagementPermission(currentOrg.effectivePermissions, 'integrations') ? <Button size="small" startIcon={<SettingsIcon />} onClick={() => router.push('/app/settings?tab=google')}>出力先の設定</Button> : undefined} />

       <PageBody maxWidth={false}>
           {reports.length >= 500 && (
             <Alert severity="info" sx={{ mb: 2 }}>
               最初の500件を表示しています。日付や利用者で絞り込んでください。
             </Alert>
           )}

           <Box sx={{ p: 2, mb: 3, bgcolor: 'background.muted' }}>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} flexWrap="wrap" useFlexGap>
                    <Box display="flex" alignItems="center" gap={1} color="text.secondary" sx={{ minWidth: 0 }}>
                        <FilterListIcon fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold">絞り込み:</Typography>
                    </Box>
                    <TextField select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: { xs: 0, md: 150 }, bgcolor: 'background.paper', width: { xs: '100%', md: 'auto' } }}>
                        <MenuItem value="all">全員</MenuItem>
                        {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                    </TextField>
                    <TextField select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: { xs: 0, md: 120 }, bgcolor: 'background.paper', width: { xs: '100%', md: 'auto' } }}>
                        <MenuItem value="all">全て</MenuItem><MenuItem value="pending">{getReportStatusLabel('pending')}</MenuItem><MenuItem value="approved">{getReportStatusLabel('approved')}</MenuItem>
                    </TextField>
                    <Box display="flex" alignItems="center" gap={1} sx={{ flexDirection: { xs: 'column', sm: 'row' }, width: { xs: '100%', md: 'auto' } }}>
                        <TextField type="date" label="開始日" size="small" slotProps={{ inputLabel: { shrink: true } }} value={startDate} onChange={(e) => setStartDate(e.target.value)} sx={{ bgcolor: 'background.paper', width: { xs: '100%', sm: 'auto' } }} />
                        <Typography sx={{ display: { xs: 'none', sm: 'block' } }}>～</Typography>
                        <TextField type="date" label="終了日" size="small" slotProps={{ inputLabel: { shrink: true } }} value={endDate} onChange={(e) => setEndDate(e.target.value)} sx={{ bgcolor: 'background.paper', width: { xs: '100%', sm: 'auto' } }} />
                    </Box>
                    {!isExportView && <FormControlLabel control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />} label="未承認・差戻しのみ" />}
                    <Button variant="contained" startIcon={<SearchIcon />} onClick={fetchReports} sx={{ px: 3, boxShadow: 'none', width: { xs: '100%', md: 'auto' } }}>検索</Button>
                </Stack>
              </Stack>
           </Box>
           
           <Box sx={{ p: 2, mb: 2, bgcolor: selected.length > 0 ? 'background.tint' : 'background.paper', display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
               <Box>
                   <Typography variant="body1" fontWeight="bold">
                       {selected.length > 0 ? `${selected.length} 件選択中` : `検索結果: ${reports.length} 件`}
                   </Typography>
               </Box>
               <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}>
                 {isExportView && <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={processing}>CSV</Button>}
                 {isExportView && <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportTravelCosts} disabled={processing}>交通費精算CSV</Button>}
                 {isExportView && <Button variant="outlined" size="small" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleBulkDownloadPDF}>PDF</Button>}
                 {selected.length > 0 ? (
                    <>
                        {isExportView && <Button variant="contained" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={!!gasProgress}>
                            {gasProgress ? '作成中...' : '帳票作成(GAS)'}
                        </Button>}
                        {!isExportView && canApproveRecords && <Button variant="contained" size="small" startIcon={<CheckCircleIcon />} onClick={handleBulkApprove} disabled={processing} sx={{ boxShadow: 'none' }}>一括承認</Button>}
                        {!isExportView && canApproveRecords && <Button variant="contained" size="small" color="warning" startIcon={<RestoreIcon />} onClick={handleBulkRemand} disabled={processing}>一括差戻し</Button>}
                        {!isExportView && canDeleteRecords && <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />} onClick={handleBulkDelete} disabled={processing}>削除</Button>}
                    </>
                 ) : isExportView ? (
                     <Button variant="outlined" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={!!gasProgress}>
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
             {isMobile && (
               <Stack divider={<Divider />} sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                 {reports.map((row) => {
                   const start = new Date(row.start_at);
                   const end = new Date(row.end_at);
                   const isAbnormal = isAbnormalReport(row);
                   const checked = selected.includes(row.id);

                   return (
                     <Box key={row.id} sx={{ p: 1.5, bgcolor: isAbnormal ? 'background.danger' : 'background.paper' }}>
                       <Stack spacing={1.25}>
                         <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
                           <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                             <Checkbox checked={checked} onClick={(e) => handleClick(e, row.id)} sx={{ p: 0.5 }} />
                             <Box minWidth={0}>
                               <Typography variant="subtitle2" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{row.clients.name}</Typography>
                               <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{getHelperNames(row)}</Typography>
                             </Box>
                           </Box>
                           <Chip label={getReportStatusLabel(row.status)} color={getReportStatusChipColor(row.status)} size="small" variant="outlined" />
                         </Box>
                         <Box display="flex" alignItems="flex-start" gap={1}>
                           <Box flexGrow={1} minWidth={0}>
                             <Typography variant="body2" color={isAbnormal ? 'error' : 'inherit'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                               {formatReportDateTime(start)} 〜
                             </Typography>
                             <Typography variant="body2" color={isAbnormal ? 'error' : 'text.secondary'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                               {formatReportDateTime(end)}
                             </Typography>
                           </Box>
                           {isAbnormal && <ErrorOutlineIcon color="error" fontSize="small" />}
                         </Box>
                         <Box display="flex" justifyContent="flex-end">
                           <Button size="small" variant={isAbnormal ? "contained" : "outlined"} color={isAbnormal ? "error" : "primary"} onClick={() => handleOpenDetail(row)} sx={{ fontSize: '0.75rem', py: 0.5 }}>
                             {isAbnormal ? "確認・修正" : "詳細"}
                           </Button>
                         </Box>
                       </Stack>
                     </Box>
                   );
                 })}
                 {reports.length === 0 && <Box sx={{ py: 5, px: 2, textAlign: 'center', color: 'text.disabled' }}>該当する記録がありません</Box>}
               </Stack>
             )}
             <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
               <Table>
                 <TableHead sx={{ bgcolor: 'background.muted' }}>
                   <TableRow>
                     <TableCell padding="checkbox"><Checkbox onChange={handleSelectAllClick} /></TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>ステータス</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
                         <TableSortLabel active={orderBy === 'start_at'} direction={order} onClick={() => { setOrder(order === 'asc' ? 'desc' : 'asc'); setOrderBy('start_at'); }}>
                             開始 〜 終了日時
                         </TableSortLabel>
                     </TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>利用者</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>担当</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>操作</TableCell>
                   </TableRow>
                 </TableHead>
                 <TableBody>
                   {reports.map((row) => {
                     const start = new Date(row.start_at);
                     const end = new Date(row.end_at);
                     const isAbnormal = isAbnormalReport(row);

                     return (
                         <TableRow key={row.id} selected={selected.includes(row.id)} hover sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: isAbnormal ? 'background.danger' : 'inherit' }}>
                           <TableCell padding="checkbox"><Checkbox checked={selected.includes(row.id)} onClick={(e) => handleClick(e, row.id)} /></TableCell>
                           <TableCell><Chip label={getReportStatusLabel(row.status)} color={getReportStatusChipColor(row.status)} size="small" variant="outlined" /></TableCell>
                           
                           {/* ★修正: 開始から終了までの日時を表示し、異常があればアイコンを出す */}
                           <TableCell>
                               <Box display="flex" alignItems="center" gap={1}>
                                   <Box>
                                       <Typography variant="body2" color={isAbnormal ? 'error' : 'inherit'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                                           {formatReportDateTime(start)} 〜
                                       </Typography>
                                       <Typography variant="body2" color={isAbnormal ? 'error' : 'text.secondary'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                                           {formatReportDateTime(end)}
                                       </Typography>
                                   </Box>
                                   {isAbnormal && (
                                       <Tooltip title="期間が24時間を超えています（入力ミスの可能性があります）">
                                           <ErrorOutlineIcon color="error" fontSize="small" />
                                       </Tooltip>
                                   )}
                               </Box>
                           </TableCell>

                           <TableCell>{row.clients.name}</TableCell>
                           <TableCell>{getHelperNames(row)}</TableCell>
                           <TableCell>
                               <Button size="small" variant={isAbnormal ? "contained" : "outlined"} color={isAbnormal ? "error" : "primary"} onClick={() => handleOpenDetail(row)} sx={{ fontSize: '0.75rem', py: 0.5 }}>
                                   {isAbnormal ? "確認・修正" : "詳細"}
                               </Button>
                           </TableCell>
                         </TableRow>
                     );
                   })}
                   {reports.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.disabled' }}>該当する記録がありません</TableCell></TableRow>}
                 </TableBody>
               </Table>
             </TableContainer>
             </>
           )}
       </PageBody>
    </PageLayout>
  );
}

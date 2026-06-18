'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button,
  CircularProgress, Stack, TextField, MenuItem, Checkbox, TableSortLabel, Switch, FormControlLabel, Divider,
  LinearProgress, Tooltip
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import TagIcon from '@mui/icons-material/Tag';
import ArticleIcon from '@mui/icons-material/Article';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'; // ★追加: 警告アイコン

import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
import { ServiceRecordDocument, PdfReportData } from '@/components/pdf/ServiceRecordDocument';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { callGasApi } from '@/app/actions/gas';
import { generateKeyMap, FormItem as HelperFormItem, FormValue } from '@/utils/templateHelper';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';

type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';
type ReportValuesData = Record<string, FormValue>;

type Report = {
  id: string; start_at: string; end_at: string; created_at: string; updated_at: string; status: ReportStatus; approved_at: string | null;
  clients: { id: string; name: string; organization_id: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { data: ReportValuesData } | { data: ReportValuesData }[];
};
type ClientData = { id: string; name: string };
type CsvColumnDef = { header: string; key: string; type: 'value' | 'bool' | 'option'; matchValue?: string; };

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  
  const [reports, setReports] = useState<Report[]>([]);
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterClientId, setFilterClientId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<string>('start_at');
  const [selected, setSelected] = useState<readonly string[]>([]);
  
  const [processing, setProcessing] = useState(false);
  const [gasProgress, setGasProgress] = useState<{ total: number, current: number, currentName: string } | null>(null);

  useEffect(() => {
      const statusParam = searchParams.get('status');
      const periodParam = searchParams.get('period');
      if (statusParam === 'unapproved') setOnlyPending(true); else setOnlyPending(false);
      if (periodParam === 'current_month') {
          const now = new Date();
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const formatDate = (d: Date) => d.toISOString().split('T')[0];
          setStartDate(formatDate(firstDay)); setEndDate(formatDate(lastDay));
      }
  }, [searchParams]);

  const fetchClients = useCallback(async () => {
    if (!currentOrg) return;
    const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
    setClients((data as ClientData[]) || []);
  }, [currentOrg]);

  const fetchReports = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true); setSelected([]); 
    try {
      let query = supabase.from('reports').select(`
          *, clients!inner ( id, name, organization_id ),
          helper:profiles!reports_helper_id_fkey ( name ),
          approved_by_user:profiles!reports_approved_by_fkey ( name ),
          report_values ( data )
        `).eq('clients.organization_id', currentOrg.id).neq('status', 'draft'); 

      if (filterClientId !== 'all') query = query.eq('client_id', filterClientId);
      if (startDate) query = query.gte('start_at', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('end_at', `${endDate}T23:59:59`);
      if (onlyPending) query = query.in('status', ['pending', 'remanded']);
      else if (filterStatus !== 'all') query = query.eq('status', filterStatus);

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
  }, [currentOrg, filterClientId, filterStatus, startDate, endDate, onlyPending, orderBy, order]);

  useEffect(() => { if (!wsLoading && currentOrg) { fetchClients(); fetchReports(); } }, [wsLoading, currentOrg, fetchClients, fetchReports]);

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
        const { data: { user } } = await supabase.auth.getUser();
        const updateData = { status: 'approved' as ReportStatus, approved_by: user?.id, approved_at: new Date().toISOString() };
        await supabase.from('reports').update(updateData).in('id', selected);
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
        await supabase.from('reports').update({ status: 'remanded', approved_by: null, approved_at: null }).in('id', selected);
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
        await supabase.from('reports').delete().in('id', selected);
        setReports(prev => prev.filter(r => !selected.includes(r.id)));
        setSelected([]);
        showToast('削除しました');
    } catch (e) { 
        console.error(e);
        showToast('エラーが発生しました', 'error'); 
    } finally { setProcessing(false); }
  };

  const getReportData = (report: Report): ReportValuesData | null => {
      if (!report.report_values) return null;
      if (Array.isArray(report.report_values)) return report.report_values[0]?.data;
      return (report.report_values as { data: ReportValuesData }).data;
  };
  
  const getHelperNames = (report: Report): string => {
      const data = getReportData(report);
      const helpers = (data?._helpers as string[]) || [];
      if (helpers.length > 0) return helpers.join(', ');
      
      const fbName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;
      return fbName || '不明'; 
  };

  const getTargetReports = () => selected.length > 0 ? reports.filter(r => selected.includes(r.id)) : reports;

  const handleExportCSV = async () => {
      const targetReports = getTargetReports();
      if (targetReports.length === 0) { showToast('出力するデータがありません。', 'warning'); return; }
      if (!(await confirm({ message: `${targetReports.length}件のデータをエクスポートします。\n差し込み印刷用に全ての項目を列に展開します。よろしいですか？` }))) return;
      setProcessing(true);
      try {
        const clientIds = Array.from(new Set(targetReports.map(r => r.clients.id)));
        const { data: templates } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);

        const dynamicColumns: CsvColumnDef[] = [];
        const seenHeaders = new Set<string>();

        templates?.forEach(tmpl => {
            const schema = tmpl.schema as HelperFormItem[];
            if (!schema) return;
            schema.forEach(item => {
                if (item.type === 'section') return;
                if (['multicheckbox', 'select'].includes(item.type) && item.options) {
                    const options = item.options.split(',');
                    options.forEach((opt: string) => {
                        const cleanOpt = opt.trim();
                        const header = `${item.label}_${cleanOpt}`;
                        if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'option', matchValue: cleanOpt }); seenHeaders.add(header); }
                    });
                } else if (item.type === 'checkbox') {
                    const header = item.label;
                    if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'bool' }); seenHeaders.add(header); }
                } else {
                    const header = item.label;
                    if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: item.id, type: 'value' }); seenHeaders.add(header); }
                }
                if (item.hasDetail) {
                    const header = `${item.label}_詳細`;
                    if (!seenHeaders.has(header)) { dynamicColumns.push({ header: header, key: `${item.id}_detail`, type: 'value' }); seenHeaders.add(header); }
                }
            });
        });

        const fixedHeader = ['記録ID', 'ステータス', '利用者ID', '利用者名', '実施ヘルパー', '入力者名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間(h)', '移動時間(h)', '承認者名', '承認日時', '作成日時', '更新日時'];
        const headerRow = [...fixedHeader, ...dynamicColumns.map(c => c.header)];
        
        const rows = targetReports.map(r => {
            const data = getReportData(r) || {};
            const start = new Date(r.start_at);
            const end = new Date(r.end_at);
            const formatDate = (d: Date) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            const formatTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            let statusText = '';
            switch(r.status) { case 'approved': statusText = '承認済'; break; case 'remanded': statusText = '差戻し'; break; case 'pending': statusText = '未承認'; break; default: statusText = r.status; }

            const fbInputter = Array.isArray(r.helper) ? r.helper[0]?.name : r.helper?.name;

            const row = [
                r.id, statusText, r.clients.id, r.clients.name, getHelperNames(r), fbInputter || '不明',
                formatDate(start), formatTime(start), formatDate(end), formatTime(end),
                data.service_time || '0', data.travel_time || '0',
                r.approved_by_user?.name || '', r.approved_at ? new Date(r.approved_at).toLocaleString() : '',
                new Date(r.created_at).toLocaleString(), new Date(r.updated_at).toLocaleString()
            ];

            dynamicColumns.forEach(col => {
                const rawVal = data[col.key];
                if (col.type === 'bool') { row.push(rawVal ? '○' : ''); } 
                else if (col.type === 'option') {
                    let isMatch = false;
                    if (Array.isArray(rawVal)) isMatch = rawVal.includes(col.matchValue || '');
                    else if (typeof rawVal === 'string') isMatch = rawVal === col.matchValue;
                    row.push(isMatch ? '○' : '');
                } else {
                    if (rawVal === null || rawVal === undefined) row.push('');
                    else { const strVal = Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal); row.push(`"${strVal.replace(/"/g, '""')}"`); }
                }
            });
            return row.join(',');
        });

        const csvContent = '\uFEFF' + [headerRow.join(','), ...rows].join('\n'); 
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

  const handleBulkDownloadPDF = async () => {
      const targetReports = getTargetReports();
      if (targetReports.length === 0) { showToast('出力するデータがありません', 'warning'); return; }
      const pdfConfirmMsg = targetReports.length > 50
        ? `${targetReports.length}件のPDFを作成します。\n時間がかかる場合があります。`
        : `${targetReports.length}件のPDFを出力しますか？`;
      if (!(await confirm({ message: pdfConfirmMsg }))) return;

      try {
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
        const blob = await pdf(<ServiceRecordDocument reports={validReports} />).toBlob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `reports_${new Date().toISOString().slice(0,10)}.pdf`;
        link.click();
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
                  orgFolderId: orgInfo.google_folder_id,
                  clientName: client.name,
                  currentFolderId: client.google_folder_id
              });

              if (folderRes.status !== 'success') throw new Error(`Folder Error: ${folderRes.message}`);
              if (folderRes.folderId !== client.google_folder_id) {
                  await supabase.from('clients').update({ google_folder_id: folderRes.folderId }).eq('id', client.id);
              }
              const clientRootFolderId = folderRes.folderId;

              setGasProgress(prev => ({ ...prev!, currentName: `${client.name}: サブフォルダ作成中...` }));
              const subFolderRes = await callGasApi({
                  action: 'create_sub_folder',
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

  const handleOpenDetail = (report: Report) => { router.push(`/app/record/${report.clients.id}?reportId=${report.id}`); };
  let headerTitle = "全件表示";
  if (onlyPending) headerTitle = "未承認・差戻し";
  if (searchParams.get('period') === 'current_month') headerTitle = "今月の記録";

  if (wsLoading || !currentOrg) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
            <TagIcon sx={{ color: 'action.active', mr: 2 }} />
            <Typography variant="h6" fontWeight="bold" color="text.primary">{headerTitle}</Typography>
        </Box>

       <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
           <Paper sx={{ p: 2, mb: 3, bgcolor: '#F2F3F5', boxShadow: 'none' }}>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Box display="flex" alignItems="center" gap={1} color="#5C5E66">
                        <FilterListIcon fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold">絞り込み:</Typography>
                    </Box>
                    <TextField select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: 150, bgcolor: 'white' }}>
                        <MenuItem value="all">全員</MenuItem>
                        {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                    </TextField>
                    <TextField select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: 120, bgcolor: 'white' }}>
                        <MenuItem value="all">全て</MenuItem><MenuItem value="pending">未承認</MenuItem><MenuItem value="approved">承認済</MenuItem>
                    </TextField>
                    <Box display="flex" alignItems="center" gap={1}>
                        <TextField type="date" label="開始日" size="small" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} sx={{ bgcolor: 'white' }} />
                        <Typography>～</Typography>
                        <TextField type="date" label="終了日" size="small" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} sx={{ bgcolor: 'white' }} />
                    </Box>
                    <FormControlLabel control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />} label="未承認・差戻しのみ" />
                    <Button variant="contained" startIcon={<SearchIcon />} onClick={fetchReports} sx={{ px: 3, boxShadow: 'none' }}>検索</Button>
                </Stack>
              </Stack>
           </Paper>
           
           <Paper sx={{ p: 2, mb: 2, bgcolor: selected.length > 0 ? alpha('#2255CC', 0.1) : '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E3E5E8', boxShadow: 'none' }}>
               <Box>
                   <Typography variant="body1" fontWeight="bold">
                       {selected.length > 0 ? `${selected.length} 件選択中` : `検索結果: ${reports.length} 件`}
                   </Typography>
               </Box>
               <Stack direction="row" spacing={1}>
                 <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportCSV} disabled={processing}>CSV</Button>
                 <Button variant="outlined" size="small" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={handleBulkDownloadPDF}>PDF</Button>
                 {selected.length > 0 ? (
                    <>
                        <Divider orientation="vertical" flexItem />
                        <Button variant="contained" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={!!gasProgress}>
                            {gasProgress ? '作成中...' : '帳票作成(GAS)'}
                        </Button>
                        <Button variant="contained" size="small" startIcon={<CheckCircleIcon />} onClick={handleBulkApprove} disabled={processing} sx={{ boxShadow: 'none' }}>一括承認</Button>
                        <Button variant="contained" size="small" color="warning" startIcon={<RestoreIcon />} onClick={handleBulkRemand} disabled={processing}>一括差戻し</Button>
                        <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />} onClick={handleBulkDelete} disabled={processing}>削除</Button>
                    </>
                 ) : (
                     <Button variant="outlined" size="small" color="success" startIcon={<ArticleIcon />} onClick={handleCreateGasPdf} disabled={!!gasProgress}>
                        {gasProgress ? '作成中...' : '全件帳票作成'}
                     </Button>
                 )}
               </Stack>
           </Paper>

           {gasProgress && (
               <Box sx={{ position: 'fixed', bottom: 20, right: 20, bgcolor: 'white', p: 2, borderRadius: 2, boxShadow: 3, zIndex: 9999 }}>
                   <Typography variant="body2" fontWeight="bold">帳票作成中...</Typography>
                   <Typography variant="caption" display="block" sx={{ mb: 1 }}>{gasProgress.currentName}</Typography>
                   <LinearProgress variant="determinate" value={(gasProgress.current / gasProgress.total) * 100} sx={{ width: 250 }} />
                   <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>{gasProgress.current} / {gasProgress.total}</Typography>
               </Box>
           )}

           {loading ? <CircularProgress /> : (
             <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid #E3E5E8' }}>
               <Table>
                 <TableHead sx={{ bgcolor: '#F2F3F5' }}>
                   <TableRow>
                     <TableCell padding="checkbox"><Checkbox onChange={handleSelectAllClick} /></TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>ステータス</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>
                         <TableSortLabel active={orderBy === 'start_at'} direction={order} onClick={() => { setOrder(order === 'asc' ? 'desc' : 'asc'); setOrderBy('start_at'); }}>
                             開始 〜 終了日時
                         </TableSortLabel>
                     </TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>利用者</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>担当</TableCell>
                     <TableCell sx={{ fontWeight: 'bold', color: '#5C5E66' }}>操作</TableCell>
                   </TableRow>
                 </TableHead>
                 <TableBody>
                   {reports.map((row) => {
                     const start = new Date(row.start_at);
                     const end = new Date(row.end_at);
                     const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                     // ★異常検知: 24時間を超える、または終了が開始より前の場合
                     const isAbnormal = durationHours > 24 || durationHours < 0;

                     const formatDateTime = (d: Date) => {
                         return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                     };

                     return (
                         <TableRow key={row.id} selected={selected.includes(row.id)} hover sx={{ '&:last-child td, &:last-child th': { border: 0 }, bgcolor: isAbnormal ? '#fff5f5' : 'inherit' }}>
                           <TableCell padding="checkbox"><Checkbox checked={selected.includes(row.id)} onClick={(e) => handleClick(e, row.id)} /></TableCell>
                           <TableCell><Chip label={row.status === 'approved' ? '承認済' : row.status === 'remanded' ? '差戻し' : '未承認'} color={row.status === 'approved' ? 'success' : row.status === 'remanded' ? 'error' : 'warning'} size="small" variant="outlined" /></TableCell>
                           
                           {/* ★修正: 開始から終了までの日時を表示し、異常があればアイコンを出す */}
                           <TableCell>
                               <Box display="flex" alignItems="center" gap={1}>
                                   <Box>
                                       <Typography variant="body2" color={isAbnormal ? 'error' : 'inherit'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                                           {formatDateTime(start)} 〜
                                       </Typography>
                                       <Typography variant="body2" color={isAbnormal ? 'error' : 'text.secondary'} fontWeight={isAbnormal ? 'bold' : 'normal'}>
                                           {formatDateTime(end)}
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
                   {reports.length === 0 && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: '#999' }}>該当する記録がありません</TableCell></TableRow>}
                 </TableBody>
               </Table>
             </TableContainer>
           )}
       </Box>
    </Box>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button,
  CircularProgress, Stack, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, TextField, MenuItem,
  Checkbox, TableSortLabel, Switch, FormControlLabel
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
import { ServiceRecordDocument } from '@/components/pdf/ServiceRecordDocument';
import { useWorkspace } from '@/context/WorkspaceContext';

type ReportStatus = 'pending' | 'approved' | 'remanded';

// JSONデータの型定義
type ReportValuesData = Record<string, string | number | boolean | string[] | null>;

type Report = {
  id: string;
  service_date: string;
  start_at: string;
  end_at: string;
  status: ReportStatus;
  clients: { id: string; name: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { data: ReportValuesData } | { data: ReportValuesData }[];
};

type FormItem = { id: string; label: string; type: string; options?: string; };

type ClientData = { id: string; name: string };

export default function ReportsPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
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

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<FormItem[]>([]);
  const [openDetail, setOpenDetail] = useState(false);
  const [processing, setProcessing] = useState(false);

  const fetchClients = useCallback(async () => {
    if (!currentOrg) return;
    const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id);
    setClients((data as ClientData[]) || []);
  }, [currentOrg]);

  const fetchReports = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true); setSelected([]);
    try {
      let query = supabase
        .from('reports')
        .select(`
          *,
          clients!inner ( id, name, organization_id ),
          helper:profiles!reports_helper_id_fkey ( name ),
          approved_by_user:profiles!reports_approved_by_fkey ( name ),
          report_values ( data )
        `)
        .eq('clients.organization_id', currentOrg.id);

      if (filterClientId !== 'all') query = query.eq('client_id', filterClientId);
      if (startDate) query = query.gte('start_at', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('end_at', `${endDate}T23:59:59`);

      if (onlyPending) {
        query = query.eq('status', 'pending');
      } else if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      // constに変更
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

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      fetchClients();
      fetchReports();
    }
  }, [wsLoading, currentOrg, fetchClients, fetchReports]);

  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) { setSelected(reports.map(n => n.id)); return; }
    setSelected([]);
  };

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
      if (!confirm('一括承認しますか？')) return;
      setProcessing(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const updateData = { status: 'approved' as ReportStatus, approved_by: user?.id, approved_at: new Date().toISOString() };
        await supabase.from('reports').update(updateData).in('id', selected);
        setReports(prev => prev.map(r => selected.includes(r.id) ? { ...r, ...updateData, approved_by_user: { name: 'あなた' } } : r));
        setSelected([]);
      } catch (e) { 
        console.error(e); 
        alert('エラーが発生しました'); 
      } finally { 
        setProcessing(false); 
      }
  };

  const getReportData = (report: Report): ReportValuesData | null => {
      if (!report.report_values) return null;
      if (Array.isArray(report.report_values)) return report.report_values[0]?.data;
      return (report.report_values as { data: ReportValuesData }).data;
  };

  const handleBulkDownloadPDF = async () => {
      const targetReports = selected.length > 0 ? reports.filter(r => selected.includes(r.id)) : reports;
      if (targetReports.length === 0) return;
      try {
        const pdfReports = await Promise.all(targetReports.map(async (report) => {
          const data = getReportData(report);
          if (!data) return null;
          const { data: tmplData } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
          return {
            id: report.id, clientName: report.clients.name, helperName: report.helper.name,
            startAt: report.start_at, endAt: report.end_at, data: data, template: (tmplData?.schema as FormItem[]) || []
          };
        }));
        const validReports = pdfReports.filter((r): r is NonNullable<typeof r> => r !== null);
        const blob = await pdf(<ServiceRecordDocument reports={validReports} />).toBlob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = "reports.pdf";
        link.click();
      } catch (e) { 
        console.error(e); 
        alert('PDF作成中にエラーが発生しました'); 
      }
  };

  const handleUpdateStatus = async (status: ReportStatus) => {
      if (!selectedReport) return;
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('reports').update({ status, approved_by: status === 'approved' ? user?.id : null }).eq('id', selectedReport.id);
      setReports(prev => prev.map(r => r.id === selectedReport.id ? { ...r, status } : r));
      setOpenDetail(false);
  };
  
  const handleOpenDetail = async (report: Report) => {
      setSelectedReport(report);
      const { data } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
      setCurrentTemplate((data?.schema as FormItem[]) || []);
      setOpenDetail(true);
  };
    
  const selectedReportData = selectedReport ? getReportData(selectedReport) : null;

  if (wsLoading || !currentOrg) return null;

  return (
    <Box>
       <Paper sx={{ p: 2, mb: 3 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <FormControlLabel control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />} label="未承認のみ" />
            <TextField select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="all">全員</MenuItem>
              {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: 120 }}>
               <MenuItem value="all">全て</MenuItem><MenuItem value="pending">未承認</MenuItem><MenuItem value="approved">承認済</MenuItem>
            </TextField>
            
            {/* 日付フィルタを追加 */}
            <TextField 
                type="date" 
                label="開始日" 
                size="small" 
                InputLabelProps={{ shrink: true }} 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
            />
            <TextField 
                type="date" 
                label="終了日" 
                size="small" 
                InputLabelProps={{ shrink: true }} 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
            />

            <Button variant="contained" onClick={fetchReports}>検索</Button>
          </Stack>
       </Paper>
       
       {selected.length > 0 && (
         <Paper sx={{ p: 2, mb: 2, bgcolor: alpha('#2255CC', 0.1), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <Typography>{selected.length} 件選択中</Typography>
           <Stack direction="row" spacing={2}>
             <Button variant="contained" onClick={handleBulkApprove} disabled={processing}>一括承認</Button>
             <Button variant="outlined" color="error" onClick={handleBulkDownloadPDF}>PDF出力</Button>
           </Stack>
         </Paper>
       )}

       {loading ? <CircularProgress /> : (
         <TableContainer>
           <Table>
             <TableHead>
               <TableRow>
                 <TableCell padding="checkbox"><Checkbox onChange={handleSelectAllClick} /></TableCell>
                 <TableCell>ステータス</TableCell>
                 <TableCell><TableSortLabel active={orderBy === 'start_at'} direction={order} onClick={() => { setOrder(order === 'asc' ? 'desc' : 'asc'); setOrderBy('start_at'); }}>日時</TableSortLabel></TableCell>
                 <TableCell>利用者</TableCell>
                 <TableCell>担当</TableCell>
                 <TableCell>操作</TableCell>
               </TableRow>
             </TableHead>
             <TableBody>
               {reports.map((row) => (
                 <TableRow key={row.id} selected={selected.includes(row.id)}>
                   <TableCell padding="checkbox"><Checkbox checked={selected.includes(row.id)} onClick={(e) => handleClick(e, row.id)} /></TableCell>
                   <TableCell><Chip label={row.status} color={row.status === 'approved' ? 'success' : row.status === 'remanded' ? 'error' : 'warning'} size="small" /></TableCell>
                   <TableCell>{new Date(row.start_at).toLocaleDateString()} {new Date(row.start_at).getHours()}:{String(new Date(row.start_at).getMinutes()).padStart(2,'0')}</TableCell>
                   <TableCell>{row.clients.name}</TableCell>
                   <TableCell>{row.helper.name}</TableCell>
                   <TableCell><Button size="small" onClick={() => handleOpenDetail(row)}>詳細</Button></TableCell>
                 </TableRow>
               ))}
             </TableBody>
           </Table>
         </TableContainer>
       )}

       <Dialog open={openDetail} onClose={() => setOpenDetail(false)} maxWidth="md" fullWidth>
         <DialogTitle>詳細確認 <IconButton onClick={() => setOpenDetail(false)} sx={{ float: 'right' }}><CloseIcon /></IconButton></DialogTitle>
         <DialogContent dividers>
           {selectedReportData && Object.entries(selectedReportData).map(([key, value]) => {
             if (key.startsWith('_') || key.endsWith('_detail')) return null;
             const label = currentTemplate.find(t => t.id === key)?.label || key;
             return (
               <Box key={key} display="flex" borderBottom="1px solid #eee" py={1}>
                 <Typography width="40%" fontWeight="bold">{label}</Typography>
                 <Typography width="60%">{String(value)}</Typography>
               </Box>
             );
           })}
         </DialogContent>
         <DialogActions>
           {selectedReport?.status !== 'approved' ? (
             <><Button color="error" onClick={() => handleUpdateStatus('remanded')}>差戻し</Button><Button variant="contained" onClick={() => handleUpdateStatus('approved')}>承認</Button></>
           ) : <Button color="warning" onClick={() => handleUpdateStatus('remanded')}>承認取消</Button>}
         </DialogActions>
       </Dialog>
    </Box>
  );
}
'use client';

import { useEffect, useState } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Chip, Button, 
  CircularProgress, Stack, Dialog, DialogTitle, DialogContent, 
  DialogActions, Divider, IconButton, Alert, TextField, MenuItem,
  Checkbox, TableSortLabel, Switch, FormControlLabel
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SearchIcon from '@mui/icons-material/Search';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { supabase } from '@/lib/supabase';
import { pdf } from '@react-pdf/renderer';
import { ServiceRecordDocument } from '../../../components/pdf/ServiceRecordDocument';

// --- 型定義 ---
type ReportStatus = 'pending' | 'approved' | 'remanded';

type Report = {
  id: string;
  service_date: string;
  start_at: string;
  end_at: string;
  status: ReportStatus;
  clients: { id: string, name: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { data: any } | { data: any }[]; 
};

type FormItem = { id: string; label: string; type: string; options?: string; };
type Client = { id: string; name: string };
type Order = 'asc' | 'desc';

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  
  // --- フィルター状態 ---
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); 
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [onlyPending, setOnlyPending] = useState(false); 

  // --- ソート状態 ---
  const [order, setOrder] = useState<Order>('desc');
  const [orderBy, setOrderBy] = useState<string>('start_at');

  // --- 選択状態 ---
  const [selected, setSelected] = useState<readonly string[]>([]);

  // --- 詳細ダイアログ状態 ---
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<FormItem[]>([]);
  const [openDetail, setOpenDetail] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchClients();
    fetchReports();
  }, [order, orderBy, onlyPending]); 

  // --- データ取得関連 ---
  const fetchClients = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
    if (!profile) return;
    const { data } = await supabase.from('clients').select('id, name').eq('organization_id', profile.organization_id);
    setClients(data || []);
  };

  const fetchReports = async () => {
    setLoading(true);
    setSelected([]); 
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (!profile) return;

      let query = supabase
        .from('reports')
        .select(`
          *,
          clients!inner ( id, name, organization_id ),
          helper:profiles!reports_helper_id_fkey ( name ),
          approved_by_user:profiles!reports_approved_by_fkey ( name ),
          report_values ( data )
        `)
        .eq('clients.organization_id', profile.organization_id);

      if (filterClientId !== 'all') query = query.eq('client_id', filterClientId);
      if (startDate) query = query.gte('start_at', `${startDate}T00:00:00`);
      if (endDate) query = query.lte('end_at', `${endDate}T23:59:59`);
      
      if (onlyPending) {
        query = query.eq('status', 'pending');
      } else if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      if (orderBy === 'client_name') {
        query = query.order('start_at', { ascending: order === 'asc' });
      } else {
        query = query.order(orderBy, { ascending: order === 'asc' });
      }

      const { data, error } = await query;
      if (error) throw error;
      
      let sortedData = data as any[] || [];
      
      // ソート補完 (クライアント名など)
      if (orderBy === 'client_name') {
        sortedData.sort((a: any, b: any) => {
          return order === 'asc' 
            ? a.clients.name.localeCompare(b.clients.name)
            : b.clients.name.localeCompare(a.clients.name);
        });
      } else if (orderBy === 'helper_name') {
        sortedData.sort((a: any, b: any) => {
          return order === 'asc' 
            ? a.helper.name.localeCompare(b.helper.name)
            : b.helper.name.localeCompare(a.helper.name);
        });
      }

      // ★ここで型キャストを行ってエラーを防ぐ
      setReports(sortedData as Report[]);

    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // --- 一括操作関連 ---
  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const newSelected = reports.map((n) => n.id);
      setSelected(newSelected);
      return;
    }
    setSelected([]);
  };

  const handleClick = (event: React.MouseEvent<unknown>, id: string) => {
    const selectedIndex = selected.indexOf(id);
    let newSelected: readonly string[] = [];

    if (selectedIndex === -1) {
      newSelected = newSelected.concat(selected, id);
    } else if (selectedIndex === 0) {
      newSelected = newSelected.concat(selected.slice(1));
    } else if (selectedIndex === selected.length - 1) {
      newSelected = newSelected.concat(selected.slice(0, -1));
    } else if (selectedIndex > 0) {
      newSelected = newSelected.concat(
        selected.slice(0, selectedIndex),
        selected.slice(selectedIndex + 1),
      );
    }
    setSelected(newSelected);
  };

  const handleBulkApprove = async () => {
    if (!confirm(`${selected.length}件の記録を一括承認しますか？`)) return;
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const updateData = {
        status: 'approved' as ReportStatus, // ★型キャスト
        approved_by: user?.id,
        approved_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('reports')
        .update(updateData)
        .in('id', selected);

      if (error) throw error;

      // 画面更新
      setReports(prev => prev.map(r => {
        if (selected.includes(r.id)) {
          return {
            ...r,
            ...updateData,
            approved_by_user: { name: 'あなた' } // 簡易更新
          };
        }
        return r;
      }));
      
      setSelected([]);
      alert('一括承認しました');
    } catch (error) {
      console.error(error);
      alert('一括承認に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // --- PDF/詳細関連 ---
  const getReportData = (report: Report) => {
    if (!report.report_values) return null;
    if (Array.isArray(report.report_values)) return report.report_values[0]?.data;
    return (report.report_values as any).data;
  };

  const handleBulkDownloadPDF = async () => {
    const targetReports = selected.length > 0 
      ? reports.filter(r => selected.includes(r.id))
      : reports;

    if (targetReports.length === 0) return;
    
    const originalText = document.title;
    document.title = "PDF生成中...";

    try {
      const pdfReports = await Promise.all(targetReports.map(async (report) => {
        const data = getReportData(report);
        if (!data) return null;
        const { data: tmplData } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
        const template = tmplData?.schema || [];
        return {
          id: report.id,
          clientName: report.clients.name,
          helperName: report.helper.name,
          startAt: report.start_at,
          endAt: report.end_at,
          data: data,
          template: template
        };
      }));

      const validReports = pdfReports.filter(Boolean);
      if (validReports.length === 0) { alert('データなし'); return; }

      const blob = await pdf(<ServiceRecordDocument reports={validReports} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reports_export.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) { console.error(error); alert('PDFエラー'); } finally { document.title = originalText; }
  };

  // 個別詳細・承認
  const handleUpdateStatus = async (status: ReportStatus) => {
    if (!selectedReport) return;
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const updateData = {
        status: status, // 引数がすでにReportStatus型なのでキャスト不要
        approved_by: status === 'approved' ? user?.id : null,
        approved_at: status === 'approved' ? new Date().toISOString() : null
      };

      await supabase.from('reports').update(updateData).eq('id', selectedReport.id);
      
      setReports(prev => prev.map(r => {
        if (r.id === selectedReport.id) {
          return { 
            ...r, 
            ...updateData,
            // 承認者名の更新
            approved_by_user: status === 'approved' ? { name: 'あなた' } : undefined 
          };
        }
        return r;
      }));

      setOpenDetail(false);
    } catch { alert('エラー'); } finally { setProcessing(false); }
  };

  const handleOpenDetail = async (report: Report) => {
    setSelectedReport(report);
    setCurrentTemplate([]); 
    try {
      const { data } = await supabase.from('form_templates').select('schema').eq('client_id', report.clients.id).maybeSingle();
      if (data?.schema) setCurrentTemplate(data.schema as FormItem[]);
    } catch (error) { console.error(error); }
    setOpenDetail(true);
  };

  const StatusBadge = ({ status }: { status: string }) => {
    switch(status) {
      case 'approved': return <Chip label="承認済" color="success" size="small" icon={<CheckCircleIcon />} />;
      case 'remanded': return <Chip label="差戻し" color="error" size="small" />;
      default: return <Chip label="未承認" color="warning" size="small" />;
    }
  };

  const selectedReportData = selectedReport ? getReportData(selectedReport) : null;

  return (
    <Box sx={{ p: 3 }}>
      {/* 検索・フィルターエリア */}
      <Paper sx={{ p: 2, mb: 3 }} elevation={0} variant="outlined">
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
            
            <FormControlLabel
              control={<Switch checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} color="warning" />}
              label={<Typography fontWeight="bold" color={onlyPending ? "warning.main" : "text.secondary"}>未承認のみ表示</Typography>}
              sx={{ border: '1px solid #ddd', borderRadius: 2, pr: 2, mr: 2, bgcolor: onlyPending ? '#fff8e1' : 'transparent' }}
            />

            <TextField
              select label="利用者" size="small" value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} sx={{ minWidth: 150 }}
              disabled={onlyPending}
            >
              <MenuItem value="all">全員</MenuItem>
              {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <TextField
              select label="ステータス" size="small" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} sx={{ minWidth: 120 }}
              disabled={onlyPending}
            >
              <MenuItem value="all">全て</MenuItem>
              <MenuItem value="pending">未承認</MenuItem>
              <MenuItem value="approved">承認済</MenuItem>
              <MenuItem value="remanded">差戻し</MenuItem>
            </TextField>
            
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField type="date" label="開始日" size="small" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Typography>～</Typography>
              <TextField type="date" label="終了日" size="small" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Stack>

            <Button variant="contained" startIcon={<SearchIcon />} onClick={fetchReports}>検索</Button>
          </Stack>
        </Stack>
      </Paper>

      {/* 一括操作ツールバー */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 2, mb: 2, 
          bgcolor: selected.length > 0 ? alpha('#2255CC', 0.1) : 'transparent',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 60
        }}
      >
        {selected.length > 0 ? (
          <>
            <Typography variant="subtitle1" fontWeight="bold" color="primary">
              {selected.length} 件選択中
            </Typography>
            <Stack direction="row" spacing={2}>
              <Button 
                variant="contained" color="primary" 
                startIcon={<DoneAllIcon />} 
                onClick={handleBulkApprove}
                disabled={processing}
              >
                一括承認
              </Button>
              <Button 
                variant="outlined" color="error" 
                startIcon={<PictureAsPdfIcon />} 
                onClick={handleBulkDownloadPDF}
              >
                選択分をPDF出力
              </Button>
            </Stack>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              チェックボックスを選択して一括操作が可能です。
            </Typography>
            <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={handleBulkDownloadPDF} disabled={reports.length === 0}>
              表示中の全件をPDF出力
            </Button>
          </>
        )}
      </Paper>

      {/* テーブル */}
      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e0e0e0', maxHeight: '70vh' }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    color="primary"
                    indeterminate={selected.length > 0 && selected.length < reports.length}
                    checked={reports.length > 0 && selected.length === reports.length}
                    onChange={handleSelectAllClick}
                  />
                </TableCell>
                <TableCell>
                  <TableSortLabel active={orderBy === 'status'} direction={orderBy === 'status' ? order : 'asc'} onClick={() => handleRequestSort('status')}>
                    ステータス
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={orderBy === 'start_at'} direction={orderBy === 'start_at' ? order : 'asc'} onClick={() => handleRequestSort('start_at')}>
                    日時
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={orderBy === 'client_name'} direction={orderBy === 'client_name' ? order : 'asc'} onClick={() => handleRequestSort('client_name')}>
                    利用者
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={orderBy === 'helper_name'} direction={orderBy === 'helper_name' ? order : 'asc'} onClick={() => handleRequestSort('helper_name')}>
                    担当ヘルパー
                  </TableSortLabel>
                </TableCell>
                <TableCell>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center">記録がありません</TableCell></TableRow>
              ) : (
                reports.map((row) => {
                  const isItemSelected = selected.indexOf(row.id) !== -1;
                  return (
                    <TableRow 
                      key={row.id} 
                      hover 
                      selected={isItemSelected}
                      role="checkbox"
                      aria-checked={isItemSelected}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          color="primary"
                          checked={isItemSelected}
                          onClick={(event) => handleClick(event, row.id)}
                        />
                      </TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell>
                        <Typography variant="body2">{new Date(row.start_at).toLocaleDateString()}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(row.start_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} ~
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{row.clients.name}</TableCell>
                      <TableCell>{row.helper.name}</TableCell>
                      <TableCell>
                        <Button variant="outlined" size="small" startIcon={<VisibilityIcon />} onClick={() => handleOpenDetail(row)}>
                          詳細
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      
      {/* 詳細ダイアログ (変更なし) */}
      <Dialog open={openDetail} onClose={() => setOpenDetail(false)} maxWidth="md" fullWidth>
         <DialogTitle sx={{display:'flex', justifyContent:'space-between'}}>
            詳細確認
            <IconButton onClick={() => setOpenDetail(false)}><CloseIcon /></IconButton>
         </DialogTitle>
         <DialogContent dividers>
            {selectedReportData ? (
              <Stack spacing={1}>
                {Object.entries(selectedReportData).map(([key, value]) => {
                   if (key.startsWith('_') || key.endsWith('_detail')) return null;
                   const label = currentTemplate.find(t => t.id === key)?.label || key;
                   let displayValue = value;
                   if (Array.isArray(value)) displayValue = value.join(', ');
                   if (typeof value === 'boolean') displayValue = value ? '実施' : '未実施';
                   const detail = selectedReportData[`${key}_detail`];
                   return (
                     <Box key={key} display="flex" borderBottom="1px solid #eee" py={1}>
                       <Typography width="40%" fontWeight="bold" fontSize={14}>{label}</Typography>
                       <Box width="60%">
                         <Typography fontSize={14}>{String(displayValue)}</Typography>
                         {detail && <Typography fontSize={12} color="primary">↳ {String(detail)}</Typography>}
                       </Box>
                     </Box>
                   );
                })}
              </Stack>
            ) : <Typography>データなし</Typography>}
         </DialogContent>
         <DialogActions>
            {selectedReport?.status !== 'approved' ? (
              <>
                <Button onClick={() => handleUpdateStatus('remanded')} color="error">差戻し</Button>
                <Button variant="contained" onClick={() => handleUpdateStatus('approved')} startIcon={<CheckCircleIcon />}>承認する</Button>
              </>
            ) : (
              <Button onClick={() => handleUpdateStatus('remanded')} color="warning">承認取消</Button>
            )}
         </DialogActions>
      </Dialog>
    </Box>
  );
}
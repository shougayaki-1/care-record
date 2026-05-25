'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import TagIcon from '@mui/icons-material/Tag';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { useClients } from '@/hooks/useClients';
import { useReports } from '@/hooks/useReports';

// 各種リファクタリング用コンポーネント・Hooksのインポート
import { Report } from '@/utils/reportExportHelper';
import { ReportFilter } from './_components/ReportFilter';
import { ReportTable } from './_components/ReportTable';
import { BulkActionBar } from './_components/BulkActionBar';
import { GasProgressToast } from './_components/GasProgressToast';

import { useReportActions } from './_hooks/useReportActions';
import { useReportExport } from './_hooks/useReportExport';

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  
  const { clients } = useClients(currentOrg?.id);

  // 1. 同期的 setState による cascading render エラーを回避するため、
  // URLクエリパラメータを useState のイニシャライザ関数で読み込み初期化
  const [filterClientId, setFilterClientId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const [startDate, setStartDate] = useState(() => {
    const periodParam = searchParams.get('period');
    if (periodParam === 'current_month') {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        return firstDay.toISOString().split('T')[0];
    }
    return '';
  });

  const [endDate, setEndDate] = useState(() => {
    const periodParam = searchParams.get('period');
    if (periodParam === 'current_month') {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return lastDay.toISOString().split('T')[0];
    }
    return '';
  });

  const [onlyPending, setOnlyPending] = useState(() => {
    return searchParams.get('status') === 'unapproved';
  });
  
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [orderBy, setOrderBy] = useState<string>('start_at');
  const [selected, setSelected] = useState<readonly string[]>([]);

  // 2. クエリパラメータ（状態）の変化に非同期で追従させ、ESLintのエラーを排除
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const periodParam = searchParams.get('period');

    const timer = setTimeout(() => {
      setOnlyPending(statusParam === 'unapproved');
      if (periodParam === 'current_month') {
          const now = new Date();
          const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const formatDate = (d: Date) => d.toISOString().split('T')[0];
          setStartDate(formatDate(firstDay));
          setEndDate(formatDate(lastDay));
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [searchParams]);

  // フィルタ情報をメモ化
  const reportFilters = useMemo(() => ({
    clientId: filterClientId,
    status: filterStatus,
    startDate,
    endDate,
    onlyPending
  }), [filterClientId, filterStatus, startDate, endDate, onlyPending]);

  // データ抽出用の共通フック
  const { 
    reports: rawReports, 
    setReports: setRawReports, 
    loading: isReportsLoading, 
    refetch: fetchReports 
  } = useReports(currentOrg?.id, reportFilters);

  // アクション用フックの適用
  const { 
    processing: actionProcessing, 
    handleBulkApprove, 
    handleBulkRemand, 
    handleBulkDelete 
  } = useReportActions(setSelected, setRawReports, showToast);

  // エクスポート・GAS連係用フックの適用
  const { 
    exporting, 
    gasProgress, 
    handleExportCSV, 
    handleBulkDownloadPDF, 
    handleCreateGasPdf 
  } = useReportExport(currentOrg?.id, showToast);

  // クライアントサイドでの動的ソート処理
  const reports = useMemo(() => {
    const sortedData = [...rawReports];
    sortedData.sort((a, b) => {
        const valA = orderBy === 'start_at' ? a.start_at : (orderBy === 'client_name' ? a.clients.name : '');
        const valB = orderBy === 'start_at' ? b.start_at : (orderBy === 'client_name' ? b.clients.name : '');
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });
    return sortedData;
  }, [rawReports, orderBy, order]);

  // 3. 組織や検索フィルタの切り替え時の選択リセット処理を非同期マクロタスクへ逃がす
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelected([]);
    }, 0);
    return () => clearTimeout(timer);
  }, [currentOrg, reportFilters]);

  const getTargetReports = () => selected.length > 0 ? reports.filter(r => selected.includes(r.id)) : reports;
  const isProcessing = actionProcessing || exporting;

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
        <ReportFilter 
          filterClientId={filterClientId}
          setFilterClientId={setFilterClientId}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          onlyPending={onlyPending}
          setOnlyPending={setOnlyPending}
          clients={clients}
          onSearch={fetchReports}
        />
           
        <BulkActionBar 
          selectedCount={selected.length}
          totalCount={reports.length}
          processing={isProcessing}
          hasGasProgress={!!gasProgress}
          onExportCSV={() => handleExportCSV(getTargetReports())}
          onBulkDownloadPDF={() => handleBulkDownloadPDF(getTargetReports())}
          onCreateGasPdf={() => handleCreateGasPdf(getTargetReports())}
          onBulkApprove={() => handleBulkApprove(selected)}
          onBulkRemand={() => handleBulkRemand(selected)}
          onBulkDelete={() => handleBulkDelete(selected, reports)}
        />

        <GasProgressToast progress={gasProgress} />

        {isReportsLoading ? (
          <CircularProgress />
        ) : (
          <ReportTable 
            reports={reports}
            selected={selected}
            setSelected={setSelected}
            order={order}
            setOrder={setOrder}
            orderBy={orderBy}
            setOrderBy={setOrderBy}
            onOpenDetail={(report: Report) => router.push(`/app/record/${report.clients.id}?reportId=${report.id}`)}
          />
        )}
      </Box>
    </Box>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<Box p={4} textAlign="center"><CircularProgress /></Box>}>
      <ReportsContent />
    </Suspense>
  );
}
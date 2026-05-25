'use client';

import React, { useState } from 'react';
import { Box, Typography, Paper, CircularProgress, Tabs, Tab, Stack, TextField, Button } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import AssessmentIcon from '@mui/icons-material/Assessment';

import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useStatistics } from './_hooks/useStatistics';

// 子コンポーネントをインポート
import { StaffStatsTab } from './_components/StaffStatsTab';
import { ClientStatsTab } from './_components/ClientStatsTab';

export default function StatisticsPage() {
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();

    const [targetMonth, setTargetMonth] = useState<string>(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [tabIndex, setTabIndex] = useState(0); 

    const { loading, aggregatedData } = useStatistics(currentOrg, targetMonth, tabIndex, showToast);

    const handleExportCSV = () => {
        const header = ['氏名', '予定時間(h)', '実績時間(h)', '差異(h)'];
        const rows = aggregatedData.map(row => [
            `"${row.name}"`,
            row.plannedHours.toFixed(2),
            row.actualHours.toFixed(2),
            (row.actualHours - row.plannedHours).toFixed(2)
        ]);

        const csvContent = '\uFEFF' + [header.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `稼働集計_${targetMonth}_${tabIndex === 0 ? 'スタッフ別' : '利用者別'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (wsLoading || !currentOrg) return null;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 2, flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <AssessmentIcon color="action" />
                    <Typography variant="h6" fontWeight="bold" color="text.primary">統計・予実管理</Typography>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
                    <Tab label="スタッフ別" />
                    <Tab label="利用者別" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems="center" mb={3} spacing={2}>
                    <TextField 
                        type="month" 
                        label="対象月" 
                        size="small" 
                        InputLabelProps={{ shrink: true }} 
                        value={targetMonth} 
                        onChange={(e) => setTargetMonth(e.target.value)} 
                        sx={{ bgcolor: 'white', minWidth: 200 }} 
                    />
                    <Button 
                        variant="outlined" 
                        color="primary" 
                        startIcon={<DownloadIcon />} 
                        onClick={handleExportCSV} 
                        disabled={loading || aggregatedData.length === 0} 
                        sx={{ bgcolor: 'white' }}
                    >
                        CSVダウンロード
                    </Button>
                </Stack>

                <Paper sx={{ p: 0, minHeight: 400, borderRadius: 3, overflow: 'hidden', boxShadow: 'none', border: '1px solid #E3E5E8' }}>
                    {loading ? (
                        <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        tabIndex === 0 ? (
                            <StaffStatsTab data={aggregatedData} />
                        ) : (
                            <ClientStatsTab data={aggregatedData} />
                        )
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
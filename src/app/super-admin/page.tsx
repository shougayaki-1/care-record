// app/super-admin/page.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Button, Chip,
    CircularProgress, Alert
} from '@/components/ui/mui';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getAllOrganizations } from '@/app/actions/super-admin';

type Organization = {
    id: string;
    name: string;
    createdAt: string;
    staffCount: number;
    clientCount: number;
};

export default function SuperAdminDashboard() {
    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getAllOrganizations();
            setOrgs(data);
        } catch (error: unknown) {
            console.error(error);
            setError('データの取得に失敗しました。管理者権限や環境変数を確認してください。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        queueMicrotask(() => void fetchData());
    }, [fetchData]);

    return (
        <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight="bold" color="text.primary">
                    事業所管理
                </Typography>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchData}>
                    更新
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {loading ? (
                <Box display="flex" justifyContent="center" p={5}><CircularProgress /></Box>
            ) : (
                <Paper sx={{ width: '100%', overflow: 'hidden', borderRadius: 2 }}>
                    <TableContainer>
                        <Table>
                            <TableHead sx={{ bgcolor: 'background.muted' }}>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>事業所名</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>登録日</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>スタッフ数</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>利用者数</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>状態</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>顧客データ</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {orgs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                                            登録されている事業所はありません
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    orgs.map((org) => (
                                        <TableRow key={org.id} hover>
                                            <TableCell sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{org.name}</TableCell>
                                            <TableCell>{new Date(org.createdAt).toLocaleDateString()}</TableCell>
                                            <TableCell align="center">
                                                <Chip label={`${org.staffCount} 名`} size="small" />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label={`${org.clientCount} 名`} size="small" />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label="稼働中" color="success" size="small" variant="outlined" />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip label="アクセス不可" size="small" variant="outlined" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}
        </Box>
    );
}

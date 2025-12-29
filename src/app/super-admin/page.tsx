// app/super-admin/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Button, Chip,
    IconButton, Tooltip, CircularProgress, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getAllOrganizations, deleteOrganization } from '@/app/actions/super-admin';

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

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getAllOrganizations();
            setOrgs(data);
        } catch (error: any) {
            console.error(error);
            setError('データの取得に失敗しました。管理者権限や環境変数を確認してください。');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`【警告】\n本当に事業所「${name}」を削除しますか？\n\n所属するスタッフ、利用者、記録データなど、全ての関連データが永久に削除されます。この操作は取り消せません。`)) return;

        try {
            await deleteOrganization(id);
            alert('削除しました');
            fetchData();
        } catch (error) {
            console.error(error);
            alert('削除に失敗しました');
        }
    };

    return (
        <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight="bold" color="#333">
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
                            <TableHead sx={{ bgcolor: '#e0e0e0' }}>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 'bold' }}>事業所名</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>登録日</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>スタッフ数</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>利用者数</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>状態</TableCell>
                                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {orgs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 5, color: '#666' }}>
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
                                                <Tooltip title="事業所データを完全削除">
                                                    <IconButton color="error" onClick={() => handleDelete(org.id, org.name)}>
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </Tooltip>
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
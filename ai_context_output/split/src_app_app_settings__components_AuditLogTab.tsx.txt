'use client';

import { Table, TableBody, TableCell, TableHead, TableRow, Paper, TableContainer } from '@mui/material';
import { AuditLogRow } from '@/types';

interface Props {
    logs: AuditLogRow[];
}

export function AuditLogTab({ logs }: Props) {
    return (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none' }}>
            <Table>
                <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>日時</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>操作者</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>操作内容</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>対象</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {logs.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                ログはありません
                            </TableCell>
                        </TableRow>
                    ) : (
                        logs.map((log) => (
                            <TableRow key={log.id} hover>
                                <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                                <TableCell>{log.profiles?.name || '不明'}</TableCell>
                                <TableCell>{log.action_type}</TableCell>
                                <TableCell>{log.target_resource || '-'}</TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
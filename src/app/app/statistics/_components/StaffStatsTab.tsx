'use client';

import { Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Paper } from '@mui/material';
import { AggregatedRow } from '@/types';

interface Props {
    data: AggregatedRow[];
}

export function StaffStatsTab({ data }: Props) {
    return (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, boxShadow: 'none' }}>
            <Table>
                <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>スタッフ名</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>予定時間 (h)</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>実績時間 (h)</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>差異 (h)</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {data.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                データがありません
                            </TableCell>
                        </TableRow>
                    ) : (
                        data.map((row, i) => {
                            const diff = row.actualHours - row.plannedHours;
                            const isAlert = diff < -2 || diff > 2;
                            return (
                                <TableRow key={i} hover>
                                    <TableCell sx={{ fontWeight: 'bold' }}>{row.name}</TableCell>
                                    <TableCell align="right">{row.plannedHours.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold', color: '#2255CC' }}>{row.actualHours.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ color: isAlert ? '#d32f2f' : 'inherit', fontWeight: isAlert ? 'bold' : 'normal' }}>
                                        {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
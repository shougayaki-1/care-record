'use client';

import React from 'react';
import {
    Box, Typography, Paper, Button, Chip, IconButton, Tooltip, Stack, TextField,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { FetchedPatternData } from '@/types';

type Props = {
    targetMonth: string;
    setTargetMonth: (val: string) => void;
    patterns: FetchedPatternData[];
    generating: boolean;
    handleCalculatePreview: () => Promise<void>;
    handleOpenClearConfirm: () => void;
    setSelectedPattern: (p: FetchedPatternData | null) => void;
    setPatternModalOpen: (open: boolean) => void;
    handleDeletePattern: (id: string) => Promise<void>;
};

export const ShiftPatternTab = ({
    targetMonth, setTargetMonth, patterns, generating,
    handleCalculatePreview, handleOpenClearConfirm,
    setSelectedPattern, setPatternModalOpen, handleDeletePattern
}: Props) => {
    
    const formatRule = (rrule: string) => {
        let desc = '';
        if (rrule.includes('FREQ=WEEKLY')) desc += '毎週 ';
        else if (rrule.includes('FREQ=MONTHLY')) desc += '毎月 ';

        const intervalMatch = rrule.match(/INTERVAL=([0-9]+)/);
        if (intervalMatch && intervalMatch[1] !== '1') desc = `${intervalMatch[1]}週間に1回 `;

        const daysMap: Record<string, string> = { 'MO': '月', 'TU': '火', 'WE': '水', 'TH': '木', 'FR': '金', 'SA': '土', 'SU': '日' };
        const match = rrule.match(/BYDAY=([^;]+)/);
        if (match) {
            const days = match[1].split(',').map(d => {
                const num = d.replace(/[A-Z]/g, '');
                const day = d.replace(/[0-9]/g, '');
                return (num ? `第${num}` : '') + (daysMap[day] || '');
            });
            desc += days.join(', ');
        }
        return desc;
    };

    return (
        <Box>
            <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 2, bgcolor: '#F0F5FF', borderColor: '#D0E0FF' }}>
                <Typography variant="body2" sx={{ fontWeight: '500' }}>登録したひな形をベースに、指定月のカレンダーへシフトを一括展開・同期します。</Typography>
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <TextField type="month" size="small" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} sx={{ bgcolor: 'white' }} />
                    <Button variant="contained" color="secondary" startIcon={<PlayArrowIcon />} onClick={handleCalculatePreview} disabled={generating || patterns.length === 0} sx={{ boxShadow: 'none' }}>
                        一括自動展開する
                    </Button>
                    <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={handleOpenClearConfirm} disabled={generating || patterns.length === 0}>
                        一括消去する
                    </Button>
                </Stack>
            </Paper>

            <Typography variant="subtitle1" fontWeight="bold" mb={2}>登録済みのひな形パターン一覧</Typography>
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, mb: 4 }}>
                <Table>
                    <TableHead sx={{ bgcolor: '#fafafa' }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>対象の利用者</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>デフォルト担当者</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>予定時間帯</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>繰り返しサイクル</TableCell>
                            <TableCell align="center" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {patterns.length === 0 ? <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: '#666' }}>ひな形が登録されていません</TableCell></TableRow> : (
                            patterns.map((p) => (
                                <TableRow key={p.id} hover>
                                    <TableCell sx={{ fontWeight: 'bold' }}>{p.clients?.name}</TableCell>
                                    <TableCell>{p.shift_pattern_staffs.map(s => s.staffs?.name).join(', ') || '未割り当て'}</TableCell>
                                    <TableCell>{p.start_time.slice(0, 5)} 〜 {p.end_time.slice(0, 5)}</TableCell>
                                    <TableCell><Chip label={formatRule(p.rrule)} size="small" color="primary" variant="outlined" /></TableCell>
                                    <TableCell align="center">
                                        <Tooltip title="ひな形を編集"><IconButton size="small" color="primary" onClick={() => { setSelectedPattern(p); setPatternModalOpen(true); }} sx={{ mr: 1 }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                        <Tooltip title="ひな形を削除"><IconButton size="small" color="error" onClick={() => handleDeletePattern(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};
'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Box, Chip } from '@mui/material';

interface Props {
    open: boolean;
    onClose: () => void;
    targetMonth: string;
    previewDetails: { total: number; details: { title: string; count: number; isOvernight: boolean }[] } | null;
    onConfirm: () => Promise<void>;
}

export function ShiftPreviewDialog({ open, onClose, targetMonth, previewDetails, onConfirm }: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>{targetMonth}月 シフト展開の確認</DialogTitle>
            <DialogContent dividers>
                {previewDetails && (
                    <Stack spacing={2}>
                        <Typography variant="body2" paragraph>
                            以下の内容でカレンダーにシフト実体を作成します。
                        </Typography>
                        <Box p={2} bgcolor="#F0F5FF" borderRadius={2} border="1px solid #D0E0FF" mb={1.5}>
                            <Typography variant="subtitle2" fontWeight="bold" color="primary">展開予定の総シフト数： {previewDetails.total} 件</Typography>
                        </Box>
                        <Typography variant="subtitle2" fontWeight="bold">ひな形ごとの生成予定内訳:</Typography>
                        <Stack spacing={1} sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eee', p: 1, borderRadius: 1, bgcolor: '#fbfbfb' }}>
                            {previewDetails.details.map((d, index) => (
                                <Box key={index} display="flex" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" fontWeight="bold">{d.title}</Typography>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        {d.isOvernight && <Chip label="日またぎ夜勤" size="small" color="secondary" variant="outlined" sx={{ height: 16, fontSize: '0.65rem' }} />}
                                        <Typography variant="caption" color="text.secondary">{d.count} 件</Typography>
                                    </Stack>
                                </Box>
                            ))}
                        </Stack>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">閉じる</Button>
                <Button onClick={onConfirm} variant="contained" color="secondary" autoFocus>
                    確定してカレンダーに展開
                </Button>
            </DialogActions>
        </Dialog>
    );
}
'use client';

import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, RadioGroup, FormControlLabel, Radio, Box, Typography } from '@mui/material';

interface Props {
    open: boolean;
    onClose: () => void;
    targetMonth: string;
    clearMode: 'unmodified' | 'all';
    setClearMode: (mode: 'unmodified' | 'all') => void;
    onConfirm: () => Promise<void>;
}

export function ClearMonthDialog({ open, onClose, targetMonth, clearMode, setClearMode, onConfirm }: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>{targetMonth}月の展開シフトを消去</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    消去方法を選択してください。
                </DialogContentText>
                <RadioGroup value={clearMode} onChange={(e) => setClearMode(e.target.value as 'unmodified' | 'all')}>
                    <FormControlLabel
                        value="unmodified"
                        control={<Radio />}
                        label={
                            <Box sx={{ py: 1 }}>
                                <Typography variant="body2" fontWeight="bold">未変更のシフトだけ消す（推奨）</Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    手動調整済みの予定は残し、自動展開されただけの予定を消去します。
                                </Typography>
                            </Box>
                        }
                    />
                    <FormControlLabel
                        value="all"
                        control={<Radio />}
                        label={
                            <Box sx={{ py: 1 }}>
                                <Typography variant="body2" fontWeight="bold" color="error">全部一括消去する</Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    ひな形から展開された予定をすべてクリアします。
                                </Typography>
                            </Box>
                        }
                    />
                </RadioGroup>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">キャンセル</Button>
                <Button onClick={onConfirm} variant="contained" color="error">消去を実行</Button>
            </DialogActions>
        </Dialog>
    );
}
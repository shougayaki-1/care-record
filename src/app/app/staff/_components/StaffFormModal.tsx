'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, FormControl, InputLabel, Select, MenuItem, Typography } from '@mui/material';

interface AccountData {
    id: string;
    name: string;
}

interface Props {
    open: boolean;
    onClose: () => void;
    editId: string | null;
    initialName: string;
    initialLinkedUserId: string;
    accountList: AccountData[];
    onSave: (name: string, linkedUserId: string) => Promise<void>;
}

export function StaffFormModal({
    open, onClose, editId, initialName, initialLinkedUserId, accountList, onSave
}: Props) {
    const [staffName, setStaffName] = useState('');
    const [linkedUserId, setLinkedUserId] = useState('none');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setStaffName(initialName);
            setLinkedUserId(initialLinkedUserId);
        }
    }, [open, initialName, initialLinkedUserId]);

    const handleSaveClick = async () => {
        if (!staffName.trim()) return;
        setSubmitting(true);
        try {
            await onSave(staffName, linkedUserId);
            onClose();
        } catch (e) {
            console.error(e);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth disableEscapeKeyDown>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
                {editId ? 'スタッフの編集' : 'スタッフの追加'}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3} pt={1}>
                    <TextField 
                        autoFocus 
                        label="スタッフ名 (表示用)" 
                        fullWidth 
                        size="small" 
                        value={staffName} 
                        onChange={e => setStaffName(e.target.value)} 
                        required 
                        disabled={submitting}
                    />
                    <FormControl fullWidth size="small" disabled={submitting}>
                        <InputLabel>紐付けるアカウント (任意)</InputLabel>
                        <Select 
                            value={linkedUserId} 
                            onChange={(e) => setLinkedUserId(e.target.value as string)} 
                            label="紐付けるアカウント (任意)"
                        >
                            <MenuItem value="none"><em>紐付けない (転記・代理入力用)</em></MenuItem>
                            {accountList.map(acc => (
                                <MenuItem key={acc.id} value={acc.id}>{acc.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Typography variant="caption" color="text.secondary">
                        ※システムにログインして自分で記録をつけるヘルパーの場合は、その人の「アカウント」を紐付けてください。事務員が代わりに記録を打ち込むだけのスタッフの場合は「紐付けない」を選択してください。
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit" disabled={submitting}>キャンセル</Button>
                <Button 
                    onClick={handleSaveClick} 
                    variant="contained" 
                    disabled={!staffName.trim() || submitting} 
                    sx={{ boxShadow: 'none' }}
                >
                    保存
                </Button>
            </DialogActions>
        </Dialog>
    );
}
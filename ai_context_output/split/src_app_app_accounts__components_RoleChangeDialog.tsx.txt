'use client';

import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, FormControl, InputLabel, Select, MenuItem, Alert } from '@mui/material';

type Props = {
    open: boolean;
    onClose: () => void;
    accountName: string;
    editRole: string;
    setEditRole: (val: string) => void;
    isSelf: boolean;
    onConfirm: () => Promise<void>;
};

export function RoleChangeDialog({
    open, onClose, accountName, editRole, setEditRole, isSelf, onConfirm
}: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>権限の変更</DialogTitle>
            <DialogContent>
                <Box pt={1}>
                    <Typography variant="body2" mb={2}>
                        <b>{accountName}</b> さんのシステム権限を変更します。
                    </Typography>
                    <FormControl fullWidth size="small">
                        <InputLabel>システム権限</InputLabel>
                        <Select 
                            value={editRole} 
                            onChange={(e) => setEditRole(e.target.value as string)} 
                            label="システム権限"
                        >
                            <MenuItem value="staff">一般(ヘルパー) - 記録の作成のみ</MenuItem>
                            <MenuItem value="manager">管理者 - シフト管理・利用者管理</MenuItem>
                            <MenuItem value="owner">オーナー - 全ての権限・事業所設定</MenuItem>
                        </Select>
                    </FormControl>
                    {isSelf && editRole !== 'owner' && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            自分の権限を降格させると、再度オーナーに戻ることはできません。
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">キャンセル</Button>
                <Button onClick={onConfirm} variant="contained" sx={{ boxShadow: 'none' }}>変更を保存</Button>
            </DialogActions>
        </Dialog>
    );
}
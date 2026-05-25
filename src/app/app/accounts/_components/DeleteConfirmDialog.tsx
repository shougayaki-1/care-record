'use client';

import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

type Props = {
    open: boolean;
    onClose: () => void;
    status: 'active' | 'invited' | undefined;
    accountName: string;
    onConfirm: () => Promise<void>;
};

export function DeleteConfirmDialog({ open, onClose, status, accountName, onConfirm }: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                <ErrorOutlineIcon color="error" />
                {status === 'active' ? 'アカウントの削除' : '招待の取り消し'}
            </DialogTitle>
            <DialogContent>
                <Typography variant="body2" paragraph>
                    {status === 'active' 
                        ? `本当に「${accountName}」さんのアカウントをシステムから削除しますか？\n（※この事業所へのログインができなくなります）` 
                        : `「${accountName}」さんへの招待リンクを無効にしますか？`}
                </Typography>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">キャンセル</Button>
                <Button onClick={onConfirm} variant="contained" color="error" sx={{ boxShadow: 'none' }}>
                    {status === 'active' ? '削除する' : '取り消す'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
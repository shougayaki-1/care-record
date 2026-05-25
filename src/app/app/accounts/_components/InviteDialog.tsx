'use client';

import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, FormControl, InputLabel, Select, MenuItem, TextField, IconButton, Box, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';

type Props = {
    open: boolean;
    onClose: () => void;
    orgName: string;
    generatedLink: string;
    newInviteName: string;
    setNewInviteName: (val: string) => void;
    newInviteRole: string;
    setNewInviteRole: (val: string) => void;
    onGenerate: () => Promise<void>;
    onShare: () => Promise<void>;
    showToast: (msg: string) => void;
};

export function InviteDialog({
    open, onClose, orgName, generatedLink, newInviteName, setNewInviteName,
    newInviteRole, setNewInviteRole, onGenerate, onShare, showToast
}: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>新しいアカウントの招待</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3} alignItems="center" py={1}>
                    {!generatedLink ? (
                        <>
                            <FormControl fullWidth size="small">
                                <InputLabel>システム権限</InputLabel>
                                <Select 
                                    label="システム権限" 
                                    value={newInviteRole} 
                                    onChange={(e) => setNewInviteRole(e.target.value as string)}
                                >
                                    <MenuItem value="staff">一般(ヘルパー)</MenuItem>
                                    <MenuItem value="manager">管理者</MenuItem>
                                </Select>
                            </FormControl>
                            <TextField 
                                label="管理用の名前 (任意)" 
                                placeholder="例: 山田 太郎" 
                                size="small" 
                                fullWidth 
                                value={newInviteName} 
                                onChange={(e) => setNewInviteName(e.target.value)} 
                            />
                            <Button 
                                variant="contained" 
                                onClick={onGenerate} 
                                fullWidth 
                                sx={{ py: 1, boxShadow: 'none' }}
                            >
                                招待リンクを発行
                            </Button>
                        </>
                    ) : (
                        <>
                            <Typography variant="body2" textAlign="center">
                                相手にこのQRコードを読み取ってもらうか、<br/>リンクを共有してください。
                            </Typography>
                            <Box 
                                component="img" 
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(generatedLink)}`} 
                                alt="QR Code" 
                                sx={{ width: 150, height: 150, border: '1px solid #ddd', p: 1, borderRadius: 2 }} 
                            />
                            <TextField 
                                value={generatedLink} 
                                fullWidth 
                                size="small" 
                                InputProps={{ 
                                    readOnly: true, 
                                    endAdornment: (
                                        <IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}>
                                            <ContentCopyIcon />
                                        </IconButton>
                                    ) 
                                }} 
                            />
                            <Button variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={onShare}>共有メニューを開く</Button>
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">閉じる</Button>
            </DialogActions>
        </Dialog>
    );
}
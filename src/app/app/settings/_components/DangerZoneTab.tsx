'use client';

import { Stack, Typography, Divider, Box, Button, Dialog, DialogTitle, DialogContent, DialogContentText, TextField, DialogActions } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';

interface Props {
    orgName: string;
    isOwner: boolean;
    confirmInput: string;
    setConfirmInput: (val: string) => void;
    openDeleteDialog: boolean;
    setOpenDeleteDialog: (val: boolean) => void;
    openLeaveDialog: boolean;
    setOpenLeaveDialog: (val: boolean) => void;
    onDeleteOrg: () => Promise<void>;
    onLeaveOrg: () => Promise<void>;
}

export function DangerZoneTab({
    orgName, isOwner, confirmInput, setConfirmInput,
    openDeleteDialog, setOpenDeleteDialog, openLeaveDialog, setOpenLeaveDialog,
    onDeleteOrg, onLeaveOrg
}: Props) {
    return (
        <>
            <Box p={3} border="1px solid" borderColor="error.light" borderRadius={3} sx={{ bgcolor: '#fff5f5' }}>
                <Stack direction="row" alignItems="center" gap={1} mb={2}>
                    <WarningIcon color="error" />
                    <Typography variant="h6" fontWeight="bold" color="error">危険な設定</Typography>
                </Stack>
                <Stack spacing={2}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.5}>
                        <Box>
                            <Typography fontWeight="bold">事業所から脱退</Typography>
                            <Typography variant="caption" color="text.secondary" display="block">この事業所のメンバーから外れます</Typography>
                        </Box>
                        <Button variant="outlined" color="warning" startIcon={<ExitToAppIcon />} onClick={() => setOpenLeaveDialog(true)}>
                            脱退する
                        </Button>
                    </Box>
                    {isOwner && (
                        <>
                            <Divider />
                            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.5}>
                                <Box>
                                    <Typography fontWeight="bold" color="error">事業所を削除</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">
                                        すべてのデータ（利用者、記録、スタッフ情報）が永久に削除されます。この操作は取り消せません。
                                    </Typography>
                                </Box>
                                <Button variant="contained" color="error" onClick={() => { setConfirmInput(''); setOpenDeleteDialog(true); }}>
                                    削除する
                                </Button>
                            </Box>
                        </>
                    )}
                </Stack>
            </Box>

            {/* 事業所削除確認ダイアログ */}
            <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
                <DialogTitle>事業所の完全削除</DialogTitle>
                <DialogContent>
                    <DialogContentText color="error" sx={{ mb: 2 }}>
                        本当に削除しますか？この操作は取り消せません。<br/>
                        確認のため、事業所名 <b>{orgName}</b> を入力してください。
                    </DialogContentText>
                    <TextField 
                        fullWidth 
                        size="small" 
                        value={confirmInput} 
                        onChange={e => setConfirmInput(e.target.value)} 
                        placeholder={orgName} 
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenDeleteDialog(false)} color="inherit">キャンセル</Button>
                    <Button 
                        onClick={onDeleteOrg} 
                        color="error" 
                        variant="contained" 
                        disabled={confirmInput !== orgName}
                    >
                        削除実行
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 脱退確認ダイアログ */}
            <Dialog open={openLeaveDialog} onClose={() => setOpenLeaveDialog(false)}>
                <DialogTitle>脱退の確認</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        本当にこの事業所から脱退しますか？<br/>
                        オーナー権限を持っている場合は、事前に他のメンバーへ権限を譲渡する必要があります。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenLeaveDialog(false)} color="inherit">キャンセル</Button>
                    <Button onClick={onLeaveOrg} color="warning" variant="contained">脱退する</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
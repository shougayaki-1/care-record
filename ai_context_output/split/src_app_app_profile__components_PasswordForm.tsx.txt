'use client';

import { Box, Typography, TextField, Stack, Divider, Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';

interface Props {
    email: string;
    newEmail: string;
    setNewEmail: (val: string) => void;
    newPassword: string;
    setNewPassword: (val: string) => void;
    confirmPassword: string;
    setConfirmPassword: (val: string) => void;
    onUpdateEmail: () => Promise<void>;
}

export function PasswordForm({
    email, newEmail, setNewEmail,
    newPassword, setNewPassword, confirmPassword, setConfirmPassword,
    onUpdateEmail
}: Props) {
    return (
        <Stack spacing={3}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                <LockIcon color="primary" /> セキュリティ設定
            </Typography>
            
            <Stack spacing={3} mt={1}>
                {/* メールアドレス変更 */}
                <Box>
                    <Typography variant="caption" color="text.secondary" gutterBottom display="block">メールアドレス変更</Typography>
                    <Typography variant="body2" mb={1}>現在のメール: {email}</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                        <TextField 
                            label="新しいメールアドレス" 
                            fullWidth 
                            size="small" 
                            value={newEmail} 
                            onChange={e => setNewEmail(e.target.value)} 
                            sx={{ flexGrow: 1, minWidth: 200 }}
                        />
                        <Button variant="outlined" onClick={onUpdateEmail}>変更確認を送信</Button>
                    </Stack>
                </Box>

                <Divider />

                {/* パスワード変更 */}
                <Box>
                    <Typography variant="caption" color="text.secondary" gutterBottom display="block">パスワード変更</Typography>
                    <Stack spacing={2}>
                        <TextField 
                            label="新しいパスワード" 
                            type="password" 
                            value={newPassword} 
                            onChange={(e) => setNewPassword(e.target.value)} 
                            fullWidth 
                            size="small" 
                        />
                        <TextField 
                            label="確認用（再入力）" 
                            type="password" 
                            value={confirmPassword} 
                            onChange={(e) => setConfirmPassword(e.target.value)} 
                            fullWidth 
                            size="small" 
                        />
                    </Stack>
                </Box>
            </Stack>
        </Stack>
    );
}
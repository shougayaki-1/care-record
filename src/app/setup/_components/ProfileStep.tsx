'use client';

import { Box, Typography, TextField, Button, Stack } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';

type Props = {
    userName: string;
    setUserName: (val: string) => void;
    onNext: () => void;
    submitting: boolean;
};

export function ProfileStep({ userName, setUserName, onNext, submitting }: Props) {
    return (
        <Stack spacing={3}>
            <Box textAlign="center">
                <PersonIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="h5" fontWeight="bold">ようこそ！</Typography>
                <Typography variant="body2" color="text.secondary">
                    はじめに、あなたのお名前を教えてください。<br/>
                    (記録や報告書に表示されます)
                </Typography>
            </Box>
            <TextField 
                label="氏名" 
                placeholder="例: 山田 太郎" 
                fullWidth 
                value={userName} 
                onChange={(e) => setUserName(e.target.value)} 
            />
            <Button 
                variant="contained" size="large" fullWidth 
                onClick={onNext} disabled={submitting || !userName.trim()}
            >
                次へ進む
            </Button>
        </Stack>
    );
}
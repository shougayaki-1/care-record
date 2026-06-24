// app/loading.tsx
'use client';
import { tokens } from '@/styles/tokens';

import { Box, CircularProgress } from '@mui/material';

export default function Loading() {
    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                width: '100vw',
                maxWidth: '100%', // はみ出し防止
                bgcolor: tokens.neutral.bg,
                position: 'fixed', // 画面に固定してズレを防ぐ
                top: 0,
                left: 0,
                zIndex: 9999
            }}
        >
            <CircularProgress />
        </Box>
    );
}
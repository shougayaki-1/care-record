// app/loading.tsx
'use client';

import { Box, CircularProgress } from '@/components/ui/mui';

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
                bgcolor: 'background.muted',
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
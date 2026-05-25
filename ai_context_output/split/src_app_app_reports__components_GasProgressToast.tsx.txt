'use client';

import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';

interface GasProgressToastProps {
  progress: { total: number; current: number; currentName: string } | null;
}

export function GasProgressToast({ progress }: GasProgressToastProps) {
  if (!progress) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        bgcolor: 'white',
        p: 2,
        borderRadius: 2,
        boxShadow: 3,
        zIndex: 9999,
        border: '1px solid #E3E5E8',
        minWidth: 280,
      }}
    >
      <Typography variant="body2" fontWeight="bold">帳票作成中...</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {progress.currentName}
      </Typography>
      <LinearProgress variant="determinate" value={(progress.current / progress.total) * 100} sx={{ width: '100%', height: 6, borderRadius: 3 }} />
      <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right' }}>
        {progress.current} / {progress.total}
      </Typography>
    </Box>
  );
}
'use client';

import React from 'react';
import { Alert, Button, CircularProgress } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';

interface Props {
    unsyncedCount: number;
    repairingFromBanner: boolean;
    onRepair: () => Promise<void>;
}

export function UnsyncedBanner({ unsyncedCount, repairingFromBanner, onRepair }: Props) {
    if (unsyncedCount === 0) return null;

    return (
        <Alert 
            severity="warning" 
            action={
                <Button 
                    color="warning" 
                    size="small" 
                    onClick={onRepair}
                    disabled={repairingFromBanner}
                    startIcon={repairingFromBanner ? <CircularProgress size={14} color="inherit" /> : <BuildIcon />}
                >
                    {repairingFromBanner ? '修復中...' : '同期を修復する'}
                </Button>
            }
            sx={{ mb: 2, borderRadius: 3, boxShadow: 'none', border: '1px solid #ffe0b2' }}
        >
            Googleカレンダーと同期されていない予定が <strong>{unsyncedCount} 件</strong> あります。
        </Alert>
    );
}
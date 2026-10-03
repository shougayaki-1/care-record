// src/components/ui/ToastProvider.tsx
'use client';

import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';

type ToastContextType = {
    showToast: (message: string, severity?: AlertColor) => void;
    dismissToast: () => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [open, setOpen] = useState(false);
    const [sequence, setSequence] = useState(0);
    const [msg, setMsg] = useState('');
    const [severity, setSeverity] = useState<AlertColor>('success');

    const showToast = useCallback((message: string, type: AlertColor = 'success') => {
        setSequence((previous) => previous + 1);
        setMsg(message);
        setSeverity(type);
        setOpen(true);
    }, []);

    const dismissToast = useCallback(() => setOpen(false), []);
    const handleClose = (_event?: unknown, reason?: string) => {
        if (reason === 'clickaway') return;
        dismissToast();
    };
    const contextValue = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

    return (
        <ToastContext.Provider value={contextValue}>
            {children}
            <Snackbar
                key={sequence}
                open={open}
                autoHideDuration={3000}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={handleClose} severity={severity} sx={{ width: '100%', boxShadow: 3 }}>
                    {msg}
                </Alert>
            </Snackbar>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used within a ToastProvider');
    return context;
};

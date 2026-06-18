// src/components/ui/ConfirmProvider.tsx
'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { DialogContentText } from '@mui/material';
import { AppButton } from './AppButton';
import { AppDialog } from './AppDialog';
import { AppTextField } from './Fields';

export type ConfirmOptions = {
    title?: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'primary' | 'error' | 'warning';
    // 指定時はテキスト入力欄を表示し、文字列が一致するまで実行ボタンを無効化する
    requireText?: string;
};

type ConfirmContextType = {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmOptions>({ message: '' });
    const [inputValue, setInputValue] = useState('');
    // Promise を解決するためのリゾルバを保持する
    const [resolver, setResolver] = useState<{ resolve: (value: boolean) => void } | null>(null);

    const confirm = useCallback((opts: ConfirmOptions) => {
        setOptions(opts);
        setInputValue('');
        setOpen(true);
        return new Promise<boolean>((resolve) => {
            setResolver({ resolve });
        });
    }, []);

    const handleClose = (result: boolean) => {
        setOpen(false);
        resolver?.resolve(result);
        setResolver(null);
    };

    const requireMismatch = options.requireText != null && inputValue !== options.requireText;

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <AppDialog
                open={open}
                onClose={() => handleClose(false)}
                maxWidth="xs"
                title={options.title ?? '確認'}
                dividers={false}
                actions={(
                    <>
                        <AppButton variant="text" intent="secondary" onClick={() => handleClose(false)}>
                            {options.cancelText ?? 'キャンセル'}
                        </AppButton>
                        <AppButton
                            onClick={() => handleClose(true)}
                            intent={options.confirmColor === 'error' ? 'danger' : options.confirmColor === 'warning' ? 'warning' : 'primary'}
                            disabled={requireMismatch}
                        >
                            {options.confirmText ?? 'OK'}
                        </AppButton>
                    </>
                )}
            >
                    <DialogContentText component="div" sx={{ whiteSpace: 'pre-line' }}>
                        {options.message}
                    </DialogContentText>
                    {options.requireText != null && (
                        <AppTextField
                            autoFocus
                            fullWidth
                            size="small"
                            margin="dense"
                            placeholder={options.requireText}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            sx={{ mt: 2 }}
                        />
                    )}
            </AppDialog>
        </ConfirmContext.Provider>
    );
};

export const useConfirm = () => {
    const context = useContext(ConfirmContext);
    if (!context) throw new Error('useConfirm must be used within a ConfirmProvider');
    return context.confirm;
};

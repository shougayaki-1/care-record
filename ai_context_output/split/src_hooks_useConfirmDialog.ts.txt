'use client';

import { useState, useCallback } from 'react';

interface ConfirmConfig {
  title: string;
  message: string;
  severity?: 'primary' | 'warning' | 'error';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}

export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ConfirmConfig | null>(null);

  const confirm = useCallback((params: ConfirmConfig) => {
    setConfig(params);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (config?.onConfirm) {
      await config.onConfirm();
    }
    setOpen(false);
  }, [config]);

  return {
    open,
    config,
    confirm,
    handleClose,
    handleConfirm,
  };
}
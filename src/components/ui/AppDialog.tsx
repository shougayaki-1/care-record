'use client';

import {
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  type DialogProps,
} from '@mui/material';
import type { ReactNode } from 'react';

export interface AppDialogProps extends Omit<DialogProps, 'title'> {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  dividers?: boolean;
  loading?: boolean;
  preventCloseWhileLoading?: boolean;
  titleAction?: ReactNode;
  contentSx?: React.ComponentProps<typeof DialogContent>['sx'];
  actionsSx?: React.ComponentProps<typeof DialogActions>['sx'];
}

export function AppDialog({
  title,
  titleAction,
  actions,
  children,
  dividers = true,
  loading = false,
  preventCloseWhileLoading = true,
  contentSx,
  actionsSx,
  maxWidth = 'sm',
  fullWidth = true,
  onClose,
  ...props
}: AppDialogProps) {
  const handleClose: DialogProps['onClose'] = (event, reason) => {
    if (loading && preventCloseWhileLoading) return;
    onClose?.(event, reason);
  };

  return (
    <Dialog maxWidth={maxWidth} fullWidth={fullWidth} onClose={handleClose} aria-busy={loading || undefined} {...props}>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box component="span">{title}</Box>
          {titleAction}
        </Box>
      </DialogTitle>
      <DialogContent dividers={dividers} sx={contentSx}>{children}</DialogContent>
      {actions && <DialogActions sx={actionsSx}>{actions}</DialogActions>}
      {loading && <CircularProgress size={24} aria-label="処理中" sx={{ position: 'absolute', top: 20, right: titleAction ? 64 : 24 }} />}
    </Dialog>
  );
}

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
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { ReactNode } from 'react';

export interface AppDialogProps extends Omit<DialogProps, 'title'> {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  dividers?: boolean;
  loading?: boolean;
  mobileFullScreen?: boolean;
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
  mobileFullScreen = true,
  preventCloseWhileLoading = true,
  contentSx,
  actionsSx,
  maxWidth = 'sm',
  fullWidth = true,
  fullScreen,
  scroll = 'paper',
  onClose,
  sx,
  ...props
}: AppDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const resolvedFullScreen = fullScreen ?? (mobileFullScreen && isMobile);

  const handleClose: DialogProps['onClose'] = (event, reason) => {
    if (loading && preventCloseWhileLoading) return;
    onClose?.(event, reason);
  };

  return (
    <Dialog
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={resolvedFullScreen}
      scroll={scroll}
      onClose={handleClose}
      aria-busy={loading || undefined}
      sx={[
        resolvedFullScreen
          ? {
              '& .MuiDialog-paperFullScreen': {
                borderRadius: 0,
              },
            }
          : {
              '& .MuiDialog-paper': {
                borderRadius: { xs: 2, sm: 3 },
              },
            },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minWidth: 0 }}>
          <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{title}</Box>
          {titleAction}
        </Box>
      </DialogTitle>
      <DialogContent
        dividers={dividers}
        sx={[
          { minWidth: 0, WebkitOverflowScrolling: 'touch' },
          ...(Array.isArray(contentSx) ? contentSx : [contentSx]),
        ]}
      >
        {children}
      </DialogContent>
      {actions && <DialogActions sx={actionsSx}>{actions}</DialogActions>}
      {loading && <CircularProgress size={24} aria-label="処理中" sx={{ position: 'absolute', top: 20, right: titleAction ? 64 : 24 }} />}
    </Dialog>
  );
}

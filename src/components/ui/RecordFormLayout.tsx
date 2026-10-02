'use client';

import { useId, type ReactNode } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Container, IconButton, Stack } from '@mui/material';
import { AppDialog, type AppDialogProps } from './AppDialog';
import { InnerPageHeader, ScrollableActions } from './Layout';

export function RecordFormHeader({ title, onClose, actions, disabled = false, titleComponent = 'h6' }: {
  title: ReactNode;
  onClose: () => void;
  actions: ReactNode;
  disabled?: boolean;
  titleComponent?: 'h1' | 'h2' | 'h6';
}) {
  return <InnerPageHeader
    title={title}
    titleComponent={titleComponent}
    icon={<IconButton aria-label="閉じる" edge="start" onClick={onClose} disabled={disabled} sx={{ color: 'action.active' }}><CloseIcon /></IconButton>}
    actions={<ScrollableActions aria-label="記録操作" role="group" tabIndex={0}>{actions}</ScrollableActions>}
  />;
}

/** The same content width, section spacing and scrolling as the normal record. */
export function RecordFormBody({ children }: { children: ReactNode }) {
  return <Box sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', p: { xs: 2, sm: 3 } }}>
    <Container maxWidth="md" disableGutters sx={{ width: '100%' }}>
      <Stack spacing={{ xs: 2.5, sm: 4 }}>{children}</Stack>
    </Container>
  </Box>;
}

export function RecordFormDialog({ title, actions, children, onClose, loading = false, ...props }: Omit<AppDialogProps, 'title' | 'onClose' | 'header'> & {
  title: string;
  onClose: () => void;
}) {
  const titleId = useId();
  return <AppDialog
    {...props}
    title={title}
    aria-labelledby={titleId}
    maxWidth="md"
    loading={loading}
    onClose={onClose}
    header={<RecordFormHeader titleComponent="h2" title={<span id={titleId}>{title}</span>} onClose={onClose} disabled={loading} actions={actions} />}
    contentSx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
  >
    <RecordFormBody>{children}</RecordFormBody>
  </AppDialog>;
}

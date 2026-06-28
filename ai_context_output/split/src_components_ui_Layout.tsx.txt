import {
  Box,
  Chip,
  Stack,
  Typography,
  type BoxProps,
  type ChipProps,
  type PaperProps,
} from '@mui/material';
import type { ReactNode } from 'react';

export function PageLayout({ children, sx, ...props }: BoxProps) {
  return (
    <Box
      {...props}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        bgcolor: 'background.default',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export interface PageBodyProps extends Omit<BoxProps, 'maxWidth'> {
  maxWidth?: BoxProps['maxWidth'] | false;
}

export function PageBody({ children, maxWidth = 'lg', sx, ...props }: PageBodyProps) {
  const content = maxWidth === false ? children : (
    <Box sx={{ width: '100%', maxWidth, mx: 'auto', minWidth: 0 }}>{children}</Box>
  );

  return (
    <Box
      {...props}
      sx={{
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
        bgcolor: 'background.default',
        p: { xs: 2, sm: 3 },
        ...sx,
      }}
    >
      {content}
    </Box>
  );
}

export function PageContainer({ children, sx, ...props }: BoxProps) {
  return <PageBody {...props} sx={sx}>{children}</PageBody>;
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={2} mb={3}>
      <Box>
        <Typography component="h1" variant="h5">{title}</Typography>
        {description && <Typography color="text.secondary" mt={0.5}>{description}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} flexWrap="wrap">{actions}</Stack>}
    </Stack>
  );
}

export function InnerPageHeader({
  icon,
  title,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        minHeight: { xs: 64, sm: 64 },
        flexShrink: 0,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: { xs: actions ? 'column' : 'row', sm: 'row' },
        alignItems: 'center',
        justifyContent: 'space-between',
        px: { xs: 2, sm: 3 },
        py: { xs: actions ? 1.25 : 0, sm: 0 },
        gap: { xs: 1, sm: 2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, width: '100%', minWidth: 0 }}>
        {icon && <Box sx={{ color: 'action.active', display: 'flex', flexShrink: 0 }}>{icon}</Box>}
        <Typography
          variant="h6"
          fontWeight="bold"
          color="text.primary"
          sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.25 }}
        >
          {title}
        </Typography>
      </Box>
      {actions && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: { xs: 'flex-end', sm: 'flex-start' },
            gap: 1,
            flexWrap: 'wrap',
            width: { xs: '100%', sm: 'auto' },
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}

export function PageToolbar({ children, sx, ...props }: BoxProps) {
  return (
    <Box
      {...props}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: 2,
        minWidth: 0,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function PageSection({ children, sx, ...props }: BoxProps) {
  return (
    <Box
      {...props}
      sx={{
        py: { xs: 2, sm: 2.5 },
        borderTop: 1,
        borderColor: 'divider',
        minWidth: 0,
        '&:first-of-type': { borderTop: 0, pt: 0 },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function SectionCard({ children, sx, ...props }: PaperProps) {
  const boxProps = { ...props };
  delete boxProps.elevation;
  delete boxProps.square;
  delete boxProps.variant;
  return (
    <PageSection
      {...(boxProps as BoxProps)}
      sx={{
        p: { xs: 2, md: 3 },
        bgcolor: 'background.paper',
        ...sx,
      }}
    >
      {children}
    </PageSection>
  );
}

export function EmptyState({ title = 'データがありません', description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <Stack role="status" alignItems="center" textAlign="center" spacing={1.5} sx={{ py: 6, px: 2 }}>
      <Typography component="p" variant="subtitle1" fontWeight={700}>{title}</Typography>
      {description && <Typography variant="body2" color="text.secondary">{description}</Typography>}
      {action}
    </Stack>
  );
}

export type StatusTone = 'default' | 'success' | 'warning' | 'error' | 'info';
export function StatusChip({ tone = 'default', ...props }: Omit<ChipProps, 'color'> & { tone?: StatusTone }) {
  return <Chip {...props} color={tone} variant={tone === 'default' ? 'outlined' : 'filled'} />;
}

import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
  type BoxProps,
  type ChipProps,
  type PaperProps,
} from '@mui/material';
import type { ReactNode } from 'react';

export function PageContainer({ children, sx, ...props }: BoxProps) {
  return <Box {...props} sx={{ flexGrow: 1, overflowY: 'auto', bgcolor: 'background.default', p: { xs: 2, md: 3 }, ...sx }}>{children}</Box>;
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

export function SectionCard({ children, sx, ...props }: PaperProps) {
  return <Paper variant="outlined" {...props} sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, ...sx }}>{children}</Paper>;
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
        height: 64,
        flexShrink: 0,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        px: 3,
        gap: 2,
      }}
    >
      {icon && (
        <Box sx={{ color: 'action.active', display: 'flex' }}>{icon}</Box>
      )}
      <Typography
        variant="h6"
        fontWeight="bold"
        color="text.primary"
        sx={{ flexGrow: 1 }}
      >
        {title}
      </Typography>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}

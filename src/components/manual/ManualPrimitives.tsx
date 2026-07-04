'use client';

import type { ReactNode } from 'react';
import { Box, Chip, Divider, Paper, Stack, Typography } from '@/components/ui/mui';

export function ManualSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Box component="section" sx={{ py: { xs: 2.5, md: 3.5 }, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography component="h2" variant="h5" fontWeight={800}>
          {title}
        </Typography>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Stack>
      {children}
    </Box>
  );
}

export function ManualStep({ number, title, body }: { number: number; title: string; body: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {number}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography fontWeight={800}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {body}
        </Typography>
      </Box>
    </Stack>
  );
}

export function ManualCallout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'success';
  title: string;
  children: ReactNode;
}) {
  const color = tone === 'warning' ? 'warning.main' : tone === 'success' ? 'success.main' : 'primary.main';
  const bg = tone === 'warning' ? 'background.warning' : tone === 'success' ? 'background.success' : 'background.tint';
  return (
    <Box sx={{ borderLeft: 4, borderColor: color, bgcolor: bg, px: 2, py: 1.5 }}>
      <Typography fontWeight={800} sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

export function ManualDemoFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 1, bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.subtle' }}>
        <Typography fontWeight={800}>{title}</Typography>
        <Chip label="実UIコンポーネント使用" size="small" color="primary" variant="outlined" />
      </Stack>
      <Box sx={{ p: { xs: 1.5, md: 2 }, overflowX: 'auto' }}>
        {children}
      </Box>
    </Paper>
  );
}

export function ManualScreenHighlight({
  number,
  label,
  children,
}: {
  number: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ position: 'relative', border: 2, borderColor: 'primary.main', bgcolor: 'background.tint', p: 1.5, minWidth: 0 }}>
      <Box
        sx={{
          position: 'absolute',
          top: -13,
          left: -13,
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          border: 2,
          borderColor: 'background.paper',
        }}
      >
        {number}
      </Box>
      <Typography variant="caption" color="primary.main" fontWeight={800} display="block" sx={{ mb: 0.75 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export function ManualDefinitionList({ items }: { items: Array<{ term: string; description: ReactNode }> }) {
  return (
    <Stack divider={<Divider flexItem />} sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
      {items.map((item) => (
        <Stack key={item.term} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ py: 1.5 }}>
          <Typography fontWeight={800} sx={{ width: { sm: 180 }, flexShrink: 0 }}>
            {item.term}
          </Typography>
          <Typography color="text.secondary" sx={{ minWidth: 0 }}>
            {item.description}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

'use client';

import { Box, Skeleton, Stack } from '@/components/ui/mui';
import { PageBody, PageLayout } from './Layout';

function ActionSkeletons() {
  return (
    <Stack direction="row" spacing={1} justifyContent="flex-end">
      <Skeleton variant="rounded" width={96} height={36} />
      <Skeleton variant="rounded" width={120} height={36} />
    </Stack>
  );
}

export function PageHeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', sm: 'center' }}
      spacing={2}
      mb={3}
    >
      <Box sx={{ minWidth: 0 }}>
        <Skeleton variant="text" width={220} height={36} />
        <Skeleton variant="text" width={320} height={24} sx={{ maxWidth: '100%' }} />
      </Box>
      {actions && <ActionSkeletons />}
    </Stack>
  );
}

export function TablePageSkeleton() {
  return (
    <PageLayout aria-busy="true" aria-label="読み込み中">
      <PageBody maxWidth="lg">
        <PageHeaderSkeleton />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} mb={2}>
          <Skeleton variant="rounded" height={40} sx={{ flex: 1, minWidth: 180 }} />
          <Skeleton variant="rounded" width={160} height={40} />
          <Skeleton variant="rounded" width={128} height={40} />
        </Stack>
        <Box sx={{ border: 1, borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden' }}>
          <Stack direction="row" spacing={2} sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Skeleton variant="text" width="28%" />
            <Skeleton variant="text" width="18%" />
            <Skeleton variant="text" width="22%" />
            <Skeleton variant="text" width="16%" />
          </Stack>
          {Array.from({ length: 5 }).map((_, index) => (
            <Stack
              key={index}
              direction="row"
              spacing={2}
              sx={{ px: 2, py: 1.5, borderBottom: index === 4 ? 0 : 1, borderColor: 'divider' }}
            >
              <Skeleton variant="text" width="28%" />
              <Skeleton variant="text" width="18%" />
              <Skeleton variant="text" width="22%" />
              <Skeleton variant="rounded" width={80} height={24} />
            </Stack>
          ))}
        </Box>
      </PageBody>
    </PageLayout>
  );
}

export function FormPageSkeleton() {
  return (
    <PageLayout aria-busy="true" aria-label="読み込み中">
      <PageBody maxWidth="md">
        <PageHeaderSkeleton actions={false} />
        <Stack spacing={2.5} sx={{ bgcolor: 'background.paper', p: { xs: 2, sm: 3 }, borderTop: 1, borderColor: 'divider' }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Box key={index}>
              <Skeleton variant="text" width={140} height={24} />
              <Skeleton variant="rounded" height={48} />
            </Box>
          ))}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Skeleton variant="rounded" width={96} height={38} />
            <Skeleton variant="rounded" width={128} height={38} />
          </Stack>
        </Stack>
      </PageBody>
    </PageLayout>
  );
}

export function CalendarPageSkeleton() {
  return (
    <PageLayout aria-busy="true" aria-label="読み込み中">
      <PageBody maxWidth={false}>
        <PageHeaderSkeleton />
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} mb={2}>
          <Skeleton variant="rounded" width={220} height={40} />
          <Skeleton variant="rounded" width={280} height={40} sx={{ maxWidth: '100%' }} />
          <Box sx={{ flexGrow: 1 }} />
          <Skeleton variant="rounded" width={120} height={40} />
        </Stack>
        <Box sx={{ border: 1, borderColor: 'divider', bgcolor: 'background.paper', p: 2, minHeight: { xs: 520, md: 640 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Skeleton variant="rounded" width={120} height={32} />
            <Skeleton variant="text" width={180} height={36} />
            <Skeleton variant="rounded" width={120} height={32} />
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1 }}>
            {Array.from({ length: 35 }).map((_, index) => (
              <Skeleton key={index} variant="rounded" height={88} />
            ))}
          </Box>
        </Box>
      </PageBody>
    </PageLayout>
  );
}

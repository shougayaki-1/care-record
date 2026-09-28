'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import FilterListIcon from '@mui/icons-material/FilterList';
import { Box, MenuItem, Stack, TextField, Typography } from '@/components/ui/mui';

type Props = { source: 'reports' | 'ai'; canViewReports: boolean; children?: ReactNode };

export function RecordListFilterBar({ source, canViewReports, children }: Props) {
  const router = useRouter();
  return <Box sx={{ p: 2, mb: 3, bgcolor: 'background.muted' }}>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} flexWrap="wrap" useFlexGap>
      <Box display="flex" alignItems="center" gap={1} color="text.secondary" sx={{ minWidth: 0 }}>
        <FilterListIcon fontSize="small" />
        <Typography variant="subtitle2" fontWeight="bold">絞り込み:</Typography>
      </Box>
      <TextField select label="表示対象" size="small" value={source} onChange={(event) => router.push(event.target.value === 'ai' ? '/app/ai-candidates' : '/app/reports')} sx={{ minWidth: { xs: 0, md: 150 }, bgcolor: 'background.paper', width: { xs: '100%', md: 'auto' } }}>
        {canViewReports && <MenuItem value="reports">全件表示</MenuItem>}
        <MenuItem value="ai">AIのみ・要確認</MenuItem>
      </TextField>
      {children}
    </Stack>
  </Box>;
}

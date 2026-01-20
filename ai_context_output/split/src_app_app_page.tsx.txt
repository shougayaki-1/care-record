'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Box, CircularProgress } from '@mui/material';

export default function AppPage() {
  const router = useRouter();
  const { currentOrg, loading } = useWorkspace();

  useEffect(() => {
    if (!loading) {
      if (!currentOrg) {
        // 所属がない場合 -> LPかセットアップへ
        router.push('/setup');
      } else if (['owner', 'manager'].includes(currentOrg.role)) {
        router.push('/app/dashboard');
      } else {
        router.push('/app/record');
      }
    }
  }, [loading, currentOrg, router]);

  return <Box display="flex" justifyContent="center" mt={10}><CircularProgress /></Box>;
}
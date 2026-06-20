'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Alert, Box, Button, CircularProgress, Stack } from '@/components/ui/mui';
import { resolveAppDestination } from '@/utils/workspaceNavigation';

export default function AppPage() {
  const router = useRouter();
  const { currentOrg, loading, status, errorMessage, refreshWorkspace } = useWorkspace();

  useEffect(() => {
    if (!loading) {
      const destination = resolveAppDestination(status, Boolean(currentOrg));
      if (destination === '/') router.replace('/?error=session_expired');
      else if (destination) router.replace(destination);
    }
  }, [loading, status, currentOrg, router]);

  if (loading || status === 'ready' || status === 'no_membership' || status === 'session_expired') {
    return <Box display="flex" justifyContent="center" mt={10}><CircularProgress /></Box>;
  }

  return (
    <Box maxWidth={560} mx="auto" mt={10} px={2}>
      <Stack spacing={2} alignItems="center">
        <Alert severity={status === 'forbidden' ? 'warning' : 'error'} sx={{ width: '100%' }}>
          {errorMessage || '所属情報を確認できませんでした。'}
        </Alert>
        <Button variant="contained" onClick={() => void refreshWorkspace()}>再試行</Button>
      </Stack>
    </Box>
  );
}

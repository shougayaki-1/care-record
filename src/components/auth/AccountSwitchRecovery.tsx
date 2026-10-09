'use client';

import { Typography } from '@/components/ui/mui';
import { RecoveryLogoutButton } from './RecoveryLogoutButton';

export function AccountSwitchRecovery({ email }: { email?: string | null }) {
  return (
    <>
      {email && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          現在ログイン中: {email}
        </Typography>
      )}
      <RecoveryLogoutButton label="別のアカウントでログインする" />
    </>
  );
}

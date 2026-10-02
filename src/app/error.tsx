'use client';

import { RecoveryError, type RecoveryErrorProps } from '@/components/auth/RecoveryError';

export default function ErrorPage(props: RecoveryErrorProps) {
  return <RecoveryError {...props} boundary="segment" />;
}

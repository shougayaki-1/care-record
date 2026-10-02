'use client';

import { RecoveryError, type RecoveryErrorProps } from '@/components/auth/RecoveryError';

export default function GlobalError(props: RecoveryErrorProps) {
  return <html lang="ja"><body><RecoveryError {...props} boundary="global" /></body></html>;
}

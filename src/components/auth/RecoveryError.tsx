'use client';

import { useEffect } from 'react';
import { RecoveryLogoutButton } from './RecoveryLogoutButton';
import styles from './recovery.module.css';

export type RecoveryErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function RecoveryError({ error, retry, boundary }: RecoveryErrorProps & { boundary: 'segment' | 'global' }) {
  useEffect(() => {
    // Send only a category and opaque Next digest; messages/stacks may contain care data.
    const kind = /chunk|loading css/i.test(error.message) ? 'chunk' :
      /hydrat/i.test(error.message) ? 'hydration' : 'runtime';
    console.error('[CareRecord recovery]', { boundary, kind, digest: error.digest });
    void fetch('/api/auth/recovery-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundary, kind, digest: error.digest }),
      keepalive: true,
    }).catch(() => {});
  }, [error, boundary]);

  return (
    <main className={styles.surface}>
      <h1>画面を表示できませんでした</h1>
      <p>再試行するか、ログアウトしてログインし直してください。</p>
      <button type="button" onClick={retry} className={styles.button}>再試行</button>{' '}
      <button type="button" onClick={() => window.location.reload()} className={styles.button}>再読み込み</button>
      <RecoveryLogoutButton attemptClientLogout={false} />
      <p><a href="/api/auth/recover">復旧ページを開く</a></p>
    </main>
  );
}

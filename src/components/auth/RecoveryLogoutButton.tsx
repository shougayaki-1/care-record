'use client';

import { useState, type FormEvent } from 'react';
import { clearLogoutClientState } from '@/utils/logoutState';
import { runLogoutStep } from '@/utils/logoutStep';
import styles from './recovery.module.css';

export function RecoveryLogoutButton({ label = 'ログアウトしてやり直す', attemptClientLogout = true }: {
  label?: string;
  attemptClientLogout?: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    clearLogoutClientState();
    // Error boundaries use the native POST directly, without importing auth code.
    if (!attemptClientLogout) return;
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    setSubmitting(true);
    await runLogoutStep(async () => {
      const { logoutCurrentUser } = await import('@/utils/clientLogout');
      await logoutCurrentUser();
    }, 'client recovery logout failed');
    clearLogoutClientState();
    HTMLFormElement.prototype.submit.call(form);
  };

  return (
    <form action="/api/auth/recover" method="post" onSubmit={handleSubmit} className={styles.form}>
      <button type="submit" disabled={submitting} className={styles.button}>
        {submitting ? 'ログアウト中...' : label}
      </button>
    </form>
  );
}

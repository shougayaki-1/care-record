'use client';

import { recordLogout } from '@/app/actions/auth';
import { supabase } from '@/lib/supabase';
import { clearLogoutClientState } from './logoutState';
import { runLogoutStep } from './logoutStep';

export async function logoutCurrentUser(): Promise<void> {
  await runLogoutStep(recordLogout, 'server logout bookkeeping failed');
  await runLogoutStep(async () => {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw error;
  }, 'supabase signOut failed');
  clearLogoutClientState();
}

/** Native POST also clears server cookies; its HTML response hard-navigates to /. */
export function submitRecoveryLogout(form?: HTMLFormElement): void {
  clearLogoutClientState();
  const target = form ?? document.createElement('form');
  target.method = 'post';
  target.action = '/api/auth/recover';
  if (!form) document.body.appendChild(target);
  HTMLFormElement.prototype.submit.call(target);
}

export async function logoutAndRedirect(): Promise<void> {
  try {
    await logoutCurrentUser();
  } finally {
    submitRecoveryLogout();
  }
}

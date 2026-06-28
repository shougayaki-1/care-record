'use client';

import { recordLogout } from '@/app/actions/auth';
import { supabase } from '@/lib/supabase';

const LOGOUT_LOCAL_STORAGE_KEYS = ['care-record-sidebar-open'];

function clearLogoutClientState() {
  if (typeof window === 'undefined') return;
  for (const key of LOGOUT_LOCAL_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

export async function logoutCurrentUser(): Promise<void> {
  try {
    await recordLogout();
  } catch (error) {
    console.warn('server logout bookkeeping failed', error);
  }

  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) {
    console.warn('supabase signOut failed', error);
  }

  clearLogoutClientState();
}

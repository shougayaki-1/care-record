// Keep recovery independent of the Supabase client and all React providers.
export function getLogoutStorageKeys(supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): string[] {
  const keys = ['care-record-sidebar-open'];
  try {
    if (supabaseUrl) {
      const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
      keys.push(authKey, `${authKey}-user`, `${authKey}-code-verifier`);
    }
  } catch {
    // A broken environment must not prevent removal of app UI state.
  }
  return keys;
}

export function isLogoutStorageKey(name: string, keys = getLogoutStorageKeys()): boolean {
  return keys.some(key => name === key || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1))));
}

export function clearLogoutClientState(): void {
  if (typeof window === 'undefined') return;
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[storageName];
      const names = new Set(getLogoutStorageKeys());
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i);
        if (name && isLogoutStorageKey(name)) names.add(name);
      }
      for (const name of names) {
        try { storage.removeItem(name); } catch { /* Try the remaining keys. */ }
      }
    } catch {
      // Storage may be blocked by browser policy; server cookie cleanup still runs.
    }
  }
}

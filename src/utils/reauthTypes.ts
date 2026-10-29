export const REAUTH_PURPOSES = [
  'owner_transfer', 'owner_add', 'organization_delete', 'external_secret_change',
  'account_password_change', 'account_email_change', 'account_delete', 'account_password_reset',
  'mcp_connection',
] as const;
export type ReauthPurpose = (typeof REAUTH_PURPOSES)[number];
export type SsoProvider = 'google' | 'azure';
export type ReauthMethod = 'password' | SsoProvider;

export function safeReauthNext(value: string): string {
  // Only these pages can resume sensitive operations. Backslashes and arbitrary
  // origins/paths never reach NextResponse.redirect.
  try {
    const url = new URL(value, 'https://care-record.invalid');
    if (url.origin !== 'https://care-record.invalid' || value.includes('\\')) return '/app/settings';
    if (url.pathname === '/oauth/consent') {
      const id = url.searchParams.get('authorization_id');
      if (!id || !/^[a-zA-Z0-9_-]{1,512}$/.test(id)) return '/app/settings';
      return `/oauth/consent?authorization_id=${encodeURIComponent(id)}&stepup=1`;
    }
    if (!['/app/settings', '/app/profile', '/app/accounts'].includes(url.pathname)) return '/app/settings';
    return url.pathname + url.search;
  } catch { return '/app/settings'; }
}

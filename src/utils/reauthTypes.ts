export const REAUTH_PURPOSES = [
  'owner_transfer', 'organization_delete', 'external_secret_change',
  'account_password_change', 'account_email_change', 'account_delete', 'account_password_reset',
] as const;
export type ReauthPurpose = (typeof REAUTH_PURPOSES)[number];
export type SsoProvider = 'google' | 'azure';
export type ReauthMethod = 'password' | SsoProvider;

export function safeReauthNext(value: string): string {
  // Only these two pages can resume sensitive operations. Backslashes and arbitrary
  // origins/paths never reach NextResponse.redirect.
  try {
    const url = new URL(value, 'https://care-record.invalid');
    if (url.origin !== 'https://care-record.invalid' || value.includes('\\')
      || !['/app/settings', '/app/profile'].includes(url.pathname)) return '/app/settings';
    return url.pathname + url.search;
  } catch { return '/app/settings'; }
}

import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { hashNetworkIdentifier } from './audit';
import { serviceRoleForLoginSecurity } from './serviceRole';

export async function reservePasswordReset(email: string): Promise<boolean> {
  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const emailHash = hashNetworkIdentifier(email) || createHash('sha256').update(email).digest('hex');
  const client = serviceRoleForLoginSecurity();
  const { data, error } = await client.rpc('reserve_password_reset_request', {
    p_email_hash: emailHash, p_ip_hash: hashNetworkIdentifier(ip) || '',
  });
  // A missing migration or unavailable limiter never sends unrestricted emails.
  return !error && data === true;
}

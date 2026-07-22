import 'server-only';

import { createHash } from 'crypto';
import { serviceRoleForOAuthNonce } from './serviceRole';

const supabaseAdmin = serviceRoleForOAuthNonce();

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export async function storeOAuthNonce(input: {
  nonce: string;
  provider: string;
  userId: string;
  organizationId: string;
  mode?: 'connect' | 'reauthorize';
  // Google SSO-only accounts complete their step-up in the calendar OAuth
  // flow itself. Persist the requirement server-side rather than trusting a
  // client-provided callback flag.
  requiresGoogleIdentityMatch?: boolean;
  ttlMinutes?: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 10) * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('oauth_nonces').insert({
    nonce_hash: hashNonce(input.nonce),
    provider: input.provider,
    user_id: input.userId,
    organization_id: input.organizationId,
    mode: input.mode ?? 'connect',
    requires_google_identity_match: input.requiresGoogleIdentityMatch ?? false,
    expires_at: expiresAt,
  });
  if (error) throw new Error('OAuth認証を開始できませんでした');
}

/** 条件付きUPDATEによりnonceを一度だけ消費する。 */
export async function consumeOAuthNonce(input: {
  nonce: string;
  provider: string;
  userId: string;
  organizationId: string;
}): Promise<{ requiresGoogleIdentityMatch: boolean } | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('oauth_nonces')
    .update({ consumed_at: now })
    .eq('nonce_hash', hashNonce(input.nonce))
    .eq('provider', input.provider)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('requires_google_identity_match')
    .maybeSingle();
  if (error || !data) return null;
  return { requiresGoogleIdentityMatch: Boolean(data.requires_google_identity_match) };
}

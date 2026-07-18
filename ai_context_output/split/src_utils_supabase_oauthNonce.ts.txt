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
  ttlMinutes?: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 10) * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('oauth_nonces').insert({
    nonce_hash: hashNonce(input.nonce),
    provider: input.provider,
    user_id: input.userId,
    organization_id: input.organizationId,
    mode: input.mode ?? 'connect',
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
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('oauth_nonces')
    .update({ consumed_at: now })
    .eq('nonce_hash', hashNonce(input.nonce))
    .eq('provider', input.provider)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('nonce_hash')
    .maybeSingle();
  return !error && !!data;
}

import 'server-only';

import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getAuthedUser } from './auth';
import { serviceRoleForServerSessions } from './serviceRole';
import { REAUTH_GRANT_TTL_MINUTES } from '@/utils/authConstants';
import type { Database } from '@/types/database.generated';

const supabaseAdmin = serviceRoleForServerSessions();

export const REAUTH_PURPOSES = [
  'owner_transfer',
  'organization_delete',
  'external_secret_change',
] as const;

export type ReauthPurpose = (typeof REAUTH_PURPOSES)[number];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 再認証グラントのトークンを実際に発行する共通部分。
 * パスワードでの本人確認(issueReauthGrant)とOAuth step-up確認(stepupReauth.ts)の
 * どちらから呼ばれても、発行されるトークンの形と consumeReauthGrant 側の検証は同一。
 */
export async function issueGrantToken(
  purpose: ReauthPurpose,
  userId: string,
  authSessionId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REAUTH_GRANT_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertError } = await supabaseAdmin.from('reauth_grants').insert({
    token_hash: hashToken(token),
    user_id: userId,
    auth_session_id: authSessionId,
    purpose,
    expires_at: expiresAt,
  });
  if (insertError) throw new Error('再認証証明を発行できません');
  return { token, expiresAt };
}

export async function issueReauthGrant(
  purpose: ReauthPurpose,
  password: string,
): Promise<{ token: string; expiresAt: string }> {
  if (!REAUTH_PURPOSES.includes(purpose) || !password) throw new Error('再認証情報が不正です');
  const user = await getAuthedUser();
  if (!user.email) throw new Error('メールアドレスを確認できません');

  // Cookieを書き換えない一時クライアントで現在のpasswordを検証する。
  const verifier = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
  const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (error || data.user?.id !== user.id) throw new Error('再認証に失敗しました');
  await verifier.auth.signOut().catch(() => undefined);

  return issueGrantToken(purpose, user.id, user.sessionId);
}

export async function consumeReauthGrant(purpose: ReauthPurpose, token: string): Promise<{ userId: string }> {
  if (!token) throw new Error('この操作には再認証が必要です');
  const user = await getAuthedUser();
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('reauth_grants')
    .update({ used_at: now })
    .eq('token_hash', hashToken(token))
    .eq('user_id', user.id)
    .eq('auth_session_id', user.sessionId)
    .eq('purpose', purpose)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('user_id')
    .maybeSingle();
  if (error || !data) throw new Error('再認証証明が無効または使用済みです');
  return { userId: data.user_id as string };
}

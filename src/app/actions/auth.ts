'use server';

// 認証のサーバーサイド処理。3省2ガイドライン対応:
// - ログイン試行のレート制限（ブルートフォース対策）
// - ログイン成功/失敗・ログアウトの監査記録（アクセスの記録）
// パスワードログインをサーバーで行うことで、上記を確実に一元化する（@supabase/ssr のサーバーログインパターン）。

import { createSessionClient, getAuthedUser, registerSessionActivity, revokeCurrentSession, touchCurrentSession, SESSION_ABSOLUTE_HOURS } from '@/utils/supabase/auth';
import { serviceRoleForServerSessions } from '@/utils/supabase/serviceRole';
import { decodeJwtSessionId } from '@/utils/jwt';
import { createHash } from 'crypto';
import { recordAuditEvent } from '@/utils/supabase/audit';
import {
  isLoginRateLimited,
  applyProgressiveLoginDelay,
  recordLoginAttempt,
} from '@/utils/supabase/loginAttempts';
import { validatePassword } from '@/utils/passwordPolicy';
import { issueReauthGrant as createReauthGrant, type ReauthPurpose } from '@/utils/supabase/reauth';

const supabaseAdmin = serviceRoleForServerSessions();

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid_credentials' | 'email_unconfirmed' | 'error' };

export type RegistrationResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; reason: 'rate_limited' | 'invalid_password' | 'already_registered' | 'error'; message?: string };

export async function issueReauthGrant(purpose: ReauthPurpose, password: string) {
  return createReauthGrant(purpose, password);
}

/**
 * 監査基盤の障害で認証フローまで失敗させない。
 * 認証イベントは可能な限り記録し、保存失敗はサーバーログへ残して運用で検知する。
 */
async function recordAuthAuditSafely(event: Parameters<typeof recordAuditEvent>[0]): Promise<void> {
  try {
    await recordAuditEvent(event);
  } catch (error) {
    console.error('failed to record auth audit:', error);
  }
}

export async function registerWithPassword(email: string, password: string): Promise<RegistrationResult> {
  const policy = validatePassword(password);
  if (!policy.ok) return { ok: false, reason: 'invalid_password', message: policy.message };
  if (await isLoginRateLimited(email)) return { ok: false, reason: 'rate_limited' };
  await applyProgressiveLoginDelay(email);
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    await recordLoginAttempt(email, 'failure');
    await recordAuthAuditSafely({ organizationId: null, actorId: null, action: 'auth.register', resourceType: 'auth', outcome: 'failure' });
    if (error?.message.includes('already registered')) return { ok: false, reason: 'already_registered' };
    return { ok: false, reason: 'error' };
  }
  if ((data.user.identities || []).length === 0) return { ok: false, reason: 'already_registered' };
  let sessionId: string | undefined;
  if (data.session) sessionId = await registerSessionActivity(data.session);
  await recordAuthAuditSafely({ organizationId: null, actorId: data.user.id, action: 'auth.register', resourceType: 'auth',
    outcome: 'success', sessionId, details: { emailConfirmationRequired: !data.session },
  });
  return { ok: true, signedIn: !!data.session };
}

/**
 * メール/パスワードでログインする。成功時はセッション Cookie が設定される。
 * レート制限・監査・試行記録をサーバー側で確実に実施する。
 */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  if (await isLoginRateLimited(email)) {
    return { ok: false, reason: 'rate_limited' };
  }
  await applyProgressiveLoginDelay(email);

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    await recordLoginAttempt(email, 'failure');
    await recordAuthAuditSafely({
      organizationId: null,
      actorId: data?.user?.id ?? null,
      action: 'auth.login',
      resourceType: 'auth',
      outcome: 'failure',
    });
    const msg = error?.message ?? '';
    if (msg.includes('Email not confirmed')) return { ok: false, reason: 'email_unconfirmed' };
    if (msg.includes('Invalid login credentials')) return { ok: false, reason: 'invalid_credentials' };
    return { ok: false, reason: 'error' };
  }

  if (!data.session) return { ok: false, reason: 'error' };
  const sessionId = await registerSessionActivity(data.session);
  await recordLoginAttempt(email, 'success');
  await recordAuthAuditSafely({
    organizationId: null,
    actorId: data.user.id,
    action: 'auth.login',
    resourceType: 'auth',
    outcome: 'success',
    sessionId,
    details: { method: 'password' },
  });
  return { ok: true };
}

/** ログアウト直前に呼び、監査記録を残す（実際の signOut はクライアントが行う）。 */
export async function recordLogout(): Promise<void> {
  try {
    const user = await getAuthedUser();
    await recordAuditEvent({
      organizationId: null,
      actorId: user.id,
      action: 'auth.logout',
      resourceType: 'auth',
      outcome: 'success',
      sessionId: user.sessionId,
    });
    await revokeCurrentSession();
  } catch {
    // 既に未認証なら何もしない。
  }
}

/** アイドルタイムアウト用。ブラウザCookieではなくサーバー側セッション活動を更新する。 */
export async function heartbeatSession(): Promise<void> {
  await touchCurrentSession();
}

/**
 * クライアント側セッションが user_session_activity に未登録の場合（デプロイ前のセッション等）に登録する。
 * access_token をサーバーへ送り、Auth サーバーで検証した上で upsert する。
 */
export async function ensureSessionActivity(accessToken: string): Promise<boolean> {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !user) return false;
    const sessionId = decodeJwtSessionId(accessToken);
    if (!sessionId) return false;
    const sessionHash = createHash('sha256').update(accessToken).digest('hex');
    const absoluteExpiresAt = new Date(Date.now() + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000).toISOString();
    const { error: upsertError } = await supabaseAdmin.from('user_session_activity').upsert({
      auth_session_id: sessionId,
      session_hash: sessionHash,
      user_id: user.id,
      last_activity: new Date().toISOString(),
      absolute_expires_at: absoluteExpiresAt,
      revoked_at: null,
    }, { onConflict: 'auth_session_id', ignoreDuplicates: false });
    return !upsertError;
  } catch {
    return false;
  }
}

/** OAuth コールバックなど、確立済みセッションのログイン成功を記録する。 */
export async function recordOAuthLogin(method: string): Promise<void> {
  try {
    const user = await getAuthedUser();
    await recordAuditEvent({
      organizationId: null,
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'auth',
      outcome: 'success',
      details: { method },
    });
  } catch {
    // セッション未確立時は記録しない。
  }
}

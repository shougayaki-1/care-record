'use server';

// 認証のサーバーサイド処理。3省2ガイドライン対応:
// - ログイン試行のレート制限（ブルートフォース対策）
// - ログイン成功/失敗・ログアウトの監査記録（アクセスの記録）
// パスワードログインをサーバーで行うことで、上記を確実に一元化する（@supabase/ssr のサーバーログインパターン）。

import { cookies } from 'next/headers';
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
import {
  issueReauthGrant as createReauthGrant,
  tryReuseRecentReauthGrant as reuseRecentReauthGrant,
  type ReauthPurpose,
} from '@/utils/supabase/reauth';
import { beginStepUpReauth as createStepUpReauth } from '@/utils/supabase/stepupReauth';
import { classifySessionActivityAuthentication, type SessionActivityResult } from '@/utils/sessionActivity';
import { STEPUP_GRANT_COOKIE, STEPUP_NONCE_COOKIE } from '@/utils/authConstants';

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
 * 直近に同じ操作で本人確認済みなら、パスワード入力/OAuth往復なしで
 * 新しいreauth_grantsを返す(対象purposeはtryReuseRecentReauthGrant側で限定)。
 * 使えない場合はnullを返すので、呼び出し側は従来通りの再認証フローへ進む。
 */
export async function tryReuseRecentReauthGrant(purpose: ReauthPurpose) {
  return reuseRecentReauthGrant(purpose);
}

/** Google/Azureでログインしているアカウント向け。OAuthプロバイダへの再ログインを開始する。 */
export async function beginStepUpReauth(purpose: ReauthPurpose) {
  const { nonce, provider } = await createStepUpReauth(purpose);
  const cookieStore = await cookies();
  cookieStore.set(STEPUP_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10分。stepup_reauth_challenges の有効期限と揃える。
  });
  return { nonce, provider };
}

/**
 * OAuth step-up再認証の完了後、/auth/reauth-callback がhttpOnly Cookieに
 * 一度だけ保存した再認証グラントトークンを読み出し、Cookieを破棄する。
 */
export async function consumeStepUpGrantCookie(): Promise<{ token: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(STEPUP_GRANT_COOKIE)?.value;
  if (!token) return null;
  cookieStore.delete(STEPUP_GRANT_COOKIE);
  return { token };
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
export async function ensureSessionActivity(accessToken: string): Promise<SessionActivityResult> {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    // Auth rejects malformed, expired, or revoked tokens with a 4xx response.
    // Network and 5xx failures must remain retryable so a valid user is not logged out.
    const authErrorStatus = error && typeof error.status === 'number' ? error.status : null;
    if (authErrorStatus !== null) {
      return classifySessionActivityAuthentication(authErrorStatus, Boolean(user), true);
    }
    if (error) return classifySessionActivityAuthentication(null, Boolean(user), true);
    if (!user) return classifySessionActivityAuthentication(null, false);
    const sessionId = decodeJwtSessionId(accessToken);
    if (!sessionId) return { status: 'invalid_session' };
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
    return upsertError ? { status: 'transient_error' } : { status: 'ready' };
  } catch (error) {
    console.error('session activity registration failed', error);
    return { status: 'transient_error' };
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

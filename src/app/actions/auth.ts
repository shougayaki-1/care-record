'use server';

// 認証のサーバーサイド処理。3省2ガイドライン対応:
// - ログイン試行のレート制限（ブルートフォース対策）
// - ログイン成功/失敗・ログアウトの監査記録（アクセスの記録）
// パスワードログインをサーバーで行うことで、上記を確実に一元化する（@supabase/ssr のサーバーログインパターン）。

import { cookies } from 'next/headers';
import { createSessionClient, getAuthedUser, registerSessionActivity, revokeCurrentSession, touchCurrentSession } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import {
  isLoginRateLimited,
  applyProgressiveLoginDelay,
  recordLoginAttempt,
} from '@/utils/supabase/loginAttempts';
import { validatePassword } from '@/utils/passwordPolicy';
import { issueReauthGrant as createReauthGrant, type ReauthPurpose } from '@/utils/supabase/reauth';
import { beginStepUpReauth as createStepUpReauth } from '@/utils/supabase/stepupReauth';
import { STEPUP_GRANT_COOKIE, STEPUP_NONCE_COOKIE } from '@/utils/authConstants';

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid_credentials' | 'email_unconfirmed' | 'error' };

export type RegistrationResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; reason: 'rate_limited' | 'invalid_password' | 'already_registered' | 'error'; message?: string };

export async function issueReauthGrant(purpose: ReauthPurpose, password: string) {
  return createReauthGrant(purpose, password);
}

/** パスワードを持たない(SSOのみの)アカウント向け。OAuthプロバイダへの再ログインを開始する。 */
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

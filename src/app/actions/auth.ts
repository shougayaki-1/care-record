'use server';

// 認証のサーバーサイド処理。3省2ガイドライン対応:
// - ログイン試行のレート制限（ブルートフォース対策）
// - ログイン成功/失敗・ログアウトの監査記録（アクセスの記録）
// パスワードログインをサーバーで行うことで、上記を確実に一元化する（@supabase/ssr のサーバーログインパターン）。

import { createSessionClient, getAuthedUser, registerSessionActivity, revokeCurrentSession, touchCurrentSession } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import {
  isLoginRateLimited,
  applyProgressiveLoginDelay,
  recordLoginAttempt,
  LOGIN_WINDOW_MINUTES,
} from '@/utils/supabase/loginAttempts';
import { validatePassword } from '@/utils/passwordPolicy';

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid_credentials' | 'email_unconfirmed' | 'error' };

export type RegistrationResult =
  | { ok: true; signedIn: boolean }
  | { ok: false; reason: 'rate_limited' | 'invalid_password' | 'already_registered' | 'error'; message?: string };

export async function registerWithPassword(email: string, password: string): Promise<RegistrationResult> {
  const policy = validatePassword(password);
  if (!policy.ok) return { ok: false, reason: 'invalid_password', message: policy.message };
  if (await isLoginRateLimited(email)) return { ok: false, reason: 'rate_limited' };
  await applyProgressiveLoginDelay(email);
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    await recordLoginAttempt(email, 'failure');
    await recordAuditEvent({ organizationId: null, actorId: null, action: 'auth.register', resourceType: 'auth', outcome: 'failure' });
    if (error?.message.includes('already registered')) return { ok: false, reason: 'already_registered' };
    return { ok: false, reason: 'error' };
  }
  if ((data.user.identities || []).length === 0) return { ok: false, reason: 'already_registered' };
  let sessionId: string | undefined;
  if (data.session) sessionId = await registerSessionActivity(data.session);
  await recordAuditEvent({ organizationId: null, actorId: data.user.id, action: 'auth.register', resourceType: 'auth',
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
    await recordAuditEvent({
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
  await recordAuditEvent({
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

export const RATE_LIMIT_MESSAGE = `ログイン試行が一定回数を超えました。約${LOGIN_WINDOW_MINUTES}分後に再度お試しください。`;

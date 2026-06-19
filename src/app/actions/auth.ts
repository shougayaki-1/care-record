'use server';

// 認証のサーバーサイド処理。3省2ガイドライン対応:
// - ログイン試行のレート制限（ブルートフォース対策）
// - ログイン成功/失敗・ログアウトの監査記録（アクセスの記録）
// パスワードログインをサーバーで行うことで、上記を確実に一元化する（@supabase/ssr のサーバーログインパターン）。

import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import {
  isLoginRateLimited,
  recordLoginAttempt,
  LOGIN_WINDOW_MINUTES,
} from '@/utils/supabase/loginAttempts';

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid_credentials' | 'email_unconfirmed' | 'error' };

/**
 * メール/パスワードでログインする。成功時はセッション Cookie が設定される。
 * レート制限・監査・試行記録をサーバー側で確実に実施する。
 */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  if (await isLoginRateLimited()) {
    return { ok: false, reason: 'rate_limited' };
  }

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

  await recordLoginAttempt(email, 'success');
  await recordAuditEvent({
    organizationId: null,
    actorId: data.user.id,
    action: 'auth.login',
    resourceType: 'auth',
    outcome: 'success',
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
    });
  } catch {
    // 既に未認証なら何もしない。
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

export const RATE_LIMIT_MESSAGE = `ログイン試行が一定回数を超えました。約${LOGIN_WINDOW_MINUTES}分後に再度お試しください。`;

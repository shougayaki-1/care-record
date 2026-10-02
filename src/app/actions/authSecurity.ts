'use server';

import { UserFacingError, withSafeError } from '@/utils/errors';
import { prepareAccountSecurityChange } from '@/utils/supabase/accountSecurity';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { cookies, headers } from 'next/headers';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { issueReauthGrant, consumeReauthGrant } from '@/utils/supabase/reauth';
import { beginStepUpReauth } from '@/utils/supabase/stepupReauth';
import { reservePasswordReset } from '@/utils/supabase/passwordResetLimit';
import { validatePassword } from '@/utils/passwordPolicy';
import { STEPUP_GRANT_COOKIE, STEPUP_NONCE_COOKIE, REAUTH_GRANT_TTL_MINUTES } from '@/utils/authConstants';
import { RECOVERY_GRANT_COOKIE } from '@/utils/passwordRecovery';
import { REAUTH_PURPOSES, type ReauthPurpose, type ReauthMethod, type SsoProvider } from '@/utils/reauthTypes';

export async function getReauthMethods(): Promise<ReauthMethod[]> {
  return withSafeError('getReauthMethods', async () => {
    await getAuthedUser();
    const supabase = await createSessionClient();
    const [{ data: { user }, error }, password] = await Promise.all([
      supabase.auth.getUser(), supabase.rpc('current_user_has_password'),
    ]);
    if (error || !user || password.error) throw new UserFacingError('再認証方法を確認できません');
    const methods: ReauthMethod[] = password.data ? ['password'] : [];
    for (const provider of ['google', 'azure'] as const) {
      if (user.identities?.some(identity => identity.provider === provider)) methods.push(provider);
    }
    return methods;
  });
}

export async function verifyReauthPassword(purpose: ReauthPurpose, password: string) {
  return withSafeError('verifyReauthPassword', async () => {
    return issueReauthGrant(purpose, password);
  });
}

export async function startProviderReauth(purpose: ReauthPurpose, provider: SsoProvider) {
  return withSafeError('startProviderReauth', async () => {
    await getAuthedUser();
    const result = await beginStepUpReauth(purpose, provider);
    const store = await cookies();
    store.delete(STEPUP_GRANT_COOKIE);
    store.set(STEPUP_NONCE_COOKIE, result.nonce, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      maxAge: REAUTH_GRANT_TTL_MINUTES * 60,
    });
    return result;
  });
}

export async function takeProviderReauthGrant(purpose: ReauthPurpose) {
  return withSafeError('takeProviderReauthGrant', async () => {
    if (!REAUTH_PURPOSES.includes(purpose) || purpose === 'account_password_reset') return null;
    const store = await cookies();
    const token = store.get(STEPUP_GRANT_COOKIE)?.value;
    store.delete(STEPUP_GRANT_COOKIE);
    return token ? { token } : null;
  });
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  return withSafeError('requestPasswordReset', async () => {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: false };
    try {
      // The same-origin Server Action Origin determines the callback. No client
      // supplied redirect/next is accepted, and Supabase also enforces its allowlist.
      const origin = (await headers()).get('origin');
      if (!origin) return { ok: true };
      const url = new URL(origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) return { ok: true };
      if (!await reservePasswordReset(normalized)) return { ok: true };
      const supabase = await createSessionClient();
      await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: `${url.origin}/auth/recovery-callback` });
    } catch {
      // Never expose Auth errors, account existence, or reset credentials.
      console.warn('[auth] Password recovery request unavailable');
    }
    return { ok: true };
  });
}

export async function finishPasswordReset(password: string, confirmation: string) {
  return withSafeError('finishPasswordReset', async () => {
    const policy = validatePassword(password);
    if (!policy.ok) throw new UserFacingError(policy.message);
    if (password !== confirmation) throw new UserFacingError('パスワードが一致しません');
    const store = await cookies();
    const token = store.get(RECOVERY_GRANT_COOKIE)?.value;
    store.set(RECOVERY_GRANT_COOKIE, '', { path: '/auth', maxAge: 0 });
    // A regular login session, a forged cookie, and a replayed/expired link cannot
    // authorize this endpoint. The proof is bound to the recovery user/session.
    await consumeReauthGrant('account_password_reset', token || '');
    const actor = await prepareAccountSecurityChange();
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new UserFacingError('パスワードを再設定できませんでした。新しいリンクを取得してください');
    await recordAuditEvent({ organizationId: null, actorId: actor.id, sessionId: actor.sessionId, action: 'account.password_reset', resourceType: 'account', resourceId: actor.id });
    // The client follows with the shared logout flow and hard navigation, including
    // Cookie/storage cleanup when Auth sign-out is unavailable.
    return { ok: true };
  });
}

export async function changeAccountPassword(password: string, confirmation: string, token: string) {
  return withSafeError('changeAccountPassword', async () => {
    const policy = validatePassword(password);
    if (!policy.ok) throw new UserFacingError(policy.message);
    if (password !== confirmation) throw new UserFacingError('パスワードが一致しません');
    await consumeReauthGrant('account_password_change', token);
    const actor = await prepareAccountSecurityChange();
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new UserFacingError('パスワードを変更できませんでした');
    await recordAuditEvent({ organizationId: null, actorId: actor.id, sessionId: actor.sessionId, action: 'account.password_change', resourceType: 'account', resourceId: actor.id });
  });
}

export async function changeAccountEmail(email: string, token: string) {
  return withSafeError('changeAccountEmail', async () => {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserFacingError('メールアドレスを確認してください');
    await consumeReauthGrant('account_email_change', token);
    const actor = await prepareAccountSecurityChange();
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw new UserFacingError('メールアドレスを変更できませんでした');
    await recordAuditEvent({ organizationId: null, actorId: actor.id, sessionId: actor.sessionId, action: 'account.email_change_request', resourceType: 'account', resourceId: actor.id });
  });
}

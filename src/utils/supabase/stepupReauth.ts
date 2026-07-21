import 'server-only';

import { createHash, randomBytes } from 'crypto';
import { createSessionClient } from './auth';
import { serviceRoleForStepupReauth } from './serviceRole';
import { issueGrantToken, REAUTH_PURPOSES, type ReauthPurpose } from './reauth';
import { REAUTH_GRANT_TTL_MINUTES } from '@/utils/authConstants';

const supabaseAdmin = serviceRoleForStepupReauth();

// Google/Azureでログインしているアカウント向けのstep-up再認証。
// ログインプロバイダを優先するため、パスワードを別途設定済みのアカウントでも
// SSOのidentityがあればこちらを使う(パスワードのみのアカウントは呼び出し側が
// promptPasswordReauth を使う)。
// 対応するOAuthプロバイダへ再ログインさせ、戻ってきたセッションが
// 開始時と同一ユーザーであることを確認した上で reauth_grants を発行する。
// consumeReauthGrant 側の検証・利用フローは変更しない。

const SSO_PROVIDERS = ['google', 'azure'] as const;
type SsoProvider = (typeof SSO_PROVIDERS)[number];

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export async function beginStepUpReauth(purpose: ReauthPurpose): Promise<{ nonce: string; provider: SsoProvider }> {
  if (!REAUTH_PURPOSES.includes(purpose)) throw new Error('再認証情報が不正です');

  const supabase = await createSessionClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('認証が必要です');

  const identities = user.identities || [];
  const ssoIdentity = identities.find(
    (identity): identity is typeof identity & { provider: SsoProvider } =>
      (SSO_PROVIDERS as readonly string[]).includes(identity.provider),
  );
  if (!ssoIdentity) throw new Error('連携されたログイン方法が見つかりません');

  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REAUTH_GRANT_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertError } = await supabaseAdmin.from('stepup_reauth_challenges').insert({
    nonce_hash: hashNonce(nonce),
    user_id: user.id,
    purpose,
    provider: ssoIdentity.provider,
    expires_at: expiresAt,
  });
  if (insertError) throw new Error('再認証を開始できません');

  return { nonce, provider: ssoIdentity.provider };
}

export async function completeStepUpReauth(
  nonce: string,
  sessionUserId: string,
  authSessionId: string,
): Promise<{ token: string; purpose: ReauthPurpose }> {
  if (!nonce) throw new Error('再認証情報が不正です');
  const now = new Date().toISOString();

  // 条件付きUPDATEで一度きり消費する(oauth_nonces と同じパターン)。
  const { data, error } = await supabaseAdmin
    .from('stepup_reauth_challenges')
    .update({ consumed_at: now })
    .eq('nonce_hash', hashNonce(nonce))
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('user_id, purpose')
    .maybeSingle();
  if (error || !data) throw new Error('再認証証明が無効または使用済みです');

  // Googleの同意画面で開始時と別のアカウントを選んだ場合はここで弾く。
  // (この時点でセッション自体は選んだアカウントに切り替わっているが、
  //  再認証トークンは発行しない。)
  if (data.user_id !== sessionUserId) throw new Error('選択したアカウントが元のログインアカウントと一致しません');

  const purpose = data.purpose as ReauthPurpose;
  const { token } = await issueGrantToken(purpose, sessionUserId, authSessionId);
  return { token, purpose };
}

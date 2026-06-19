import 'server-only';

import { headers } from 'next/headers';
import { supabaseAdmin } from './auth';
import { hashNetworkIdentifier } from './audit';

// ログイン試行のレート制限パラメータ。
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 5;

type RequestContext = {
  ipHash: string | null;
  userAgent: string | null;
};

async function getRequestContext(): Promise<RequestContext> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  return {
    ipHash: hashNetworkIdentifier(forwardedFor),
    userAgent: requestHeaders.get('user-agent')?.slice(0, 500) || null,
  };
}

/**
 * 直近の失敗回数がしきい値以上かを返す。IP を解決できない（salt 未設定等）場合は
 * 安全側に倒さず通常通り認証へ進める（可用性のため）。
 */
export async function isLoginRateLimited(): Promise<boolean> {
  const { ipHash } = await getRequestContext();
  if (!ipHash) return false;

  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('outcome', 'failure')
    .gte('created_at', since);

  if (error) {
    // 集計に失敗した場合はブロックしない（DoS 化を避ける）。
    console.error('login rate-limit check failed:', error.message);
    return false;
  }
  return (count ?? 0) >= LOGIN_MAX_FAILURES;
}

/** ログイン試行を記録する（IP・メールはハッシュ化）。成功時は失敗カウントをリセットしない方針。 */
export async function recordLoginAttempt(email: string, outcome: 'success' | 'failure'): Promise<void> {
  const { ipHash, userAgent } = await getRequestContext();
  const { error } = await supabaseAdmin.from('login_attempts').insert({
    ip_hash: ipHash,
    email_hash: hashNetworkIdentifier(email?.toLowerCase() || null),
    outcome,
    user_agent: userAgent,
  });
  if (error) {
    // 監査ではなく運用データなので、失敗してもログインフロー自体は止めない。
    console.error('failed to record login attempt:', error.message);
  }
}

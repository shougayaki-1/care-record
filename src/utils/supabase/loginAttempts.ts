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
async function recentFailureCount(email: string): Promise<number> {
  const { ipHash } = await getRequestContext();
  const emailHash = hashNetworkIdentifier(email?.toLowerCase() || null);
  if (!ipHash && !emailHash) return 0;

  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('outcome', 'failure')
    .gte('created_at', since);
  if (ipHash && emailHash) query = query.or(`ip_hash.eq.${ipHash},email_hash.eq.${emailHash}`);
  else if (ipHash) query = query.eq('ip_hash', ipHash);
  else query = query.eq('email_hash', emailHash!);
  const { count, error } = await query;

  if (error) {
    // 集計に失敗した場合はブロックしない（DoS 化を避ける）。
    console.error('login rate-limit check failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

export async function isLoginRateLimited(email: string): Promise<boolean> {
  return await recentFailureCount(email) >= LOGIN_MAX_FAILURES;
}

/** 失敗回数に応じた遅延。固定閾値の直前でも総当たり速度を落とす。 */
export async function applyProgressiveLoginDelay(email: string): Promise<void> {
  const failures = await recentFailureCount(email);
  if (failures > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(failures * 500, 3000)));
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

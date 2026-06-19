import 'server-only';

import { createHash } from 'crypto';
import { headers } from 'next/headers';
import { supabaseAdmin } from './auth';

export type AuditEventInput = {
  // 認証イベント（ログイン/ログアウト）は組織コンテキスト未確定でも記録するため null を許容する。
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: 'success' | 'failure';
  details?: Record<string, unknown>;
};

/** 個人識別子（IP・メール等）を salt 付き SHA256 でハッシュ化する。生値は保存しない。 */
export function hashNetworkIdentifier(value: string | null): string | null {
  if (!value) return null;
  const salt = process.env.AUDIT_IP_HASH_SALT;
  if (!salt) return null;
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

/**
 * Append-only監査イベントを書き込む。医療・介護記録本文はdetailsに渡さないこと。
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const requestId = requestHeaders.get('x-vercel-id') || requestHeaders.get('x-request-id');

  const { error } = await supabaseAdmin.from('audit_events').insert({
    organization_id: input.organizationId,
    actor_id: input.actorId,
    action_type: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId || null,
    outcome: input.outcome || 'success',
    request_id: requestId,
    ip_hash: hashNetworkIdentifier(forwardedFor),
    user_agent: requestHeaders.get('user-agent')?.slice(0, 500) || null,
    details: input.details || {},
  });

  if (error) {
    throw new Error(`監査ログの保存に失敗しました: ${error.message}`);
  }
}

'use server';

import { redirect } from 'next/navigation';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { createHash } from 'crypto';
import { ExpectedActionError, sanitizeDbError, withActionResult, withSafeError } from '@/utils/errors';

export async function prepareMcpReauth(authorizationId: string, token: string) {
  return withActionResult('prepareMcpReauth', async () => {
    await getAuthedUser();
    if (typeof authorizationId !== 'string' || typeof token !== 'string'
      || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId) || !/^[a-zA-Z0-9_-]{43}$/.test(token)) {
      throw new ExpectedActionError('VALIDATION_ERROR', '接続リクエストを確認できません');
    }
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('prepare_mcp_reauth', {
      p_authorization_id: authorizationId, p_token_hash: createHash('sha256').update(token).digest('hex'),
    });
    if (error) throw sanitizeDbError(error, 'mcp.prepare-reauth');
  });
}

export async function finalizeMcpReauth(authorizationId: string): Promise<void> {
  await withSafeError('finalizeMcpReauth', async () => {
    await getAuthedUser();
    if (typeof authorizationId !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId)) {
      throw new ExpectedActionError('VALIDATION_ERROR', '接続リクエストを確認できません');
    }
    const supabase = await createSessionClient();
    const { error } = await supabase.rpc('finalize_mcp_reauth', { p_authorization_id: authorizationId });
    if (error) throw sanitizeDbError(error, 'mcp.finalize-reauth');
  });
}

export async function decideMcpAuthorization(formData: FormData): Promise<void> {
  const redirectUrl = await withSafeError('decideMcpAuthorization', async () => {
    await getAuthedUser();
    const authorizationId = formData.get('authorization_id');
    const decision = formData.get('decision');
    if (typeof authorizationId !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId)) {
      throw new ExpectedActionError('VALIDATION_ERROR', '認証リクエストが不正です');
    }
    if (decision !== 'approve' && decision !== 'deny') throw new ExpectedActionError('VALIDATION_ERROR', '認証操作が不正です');

    const supabase = await createSessionClient();
    if (decision === 'approve') {
      const prepared = await supabase.rpc('mcp_reauth_prepared', { p_authorization_id: authorizationId });
      if (prepared.error) throw sanitizeDbError(prepared.error, 'mcp.approval-reauth');
      if (!prepared.data) throw new ExpectedActionError('REAUTH_REQUIRED', '接続には本人確認が必要です。最初から接続をやり直してください。');
    }
    const response = decision === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (response.error || !response.data?.redirect_url) {
      throw new Error('接続の承認を完了できませんでした');
    }
    if (decision === 'approve') await finalizeMcpReauth(authorizationId);
    return response.data.redirect_url;
  });
  redirect(redirectUrl);
}

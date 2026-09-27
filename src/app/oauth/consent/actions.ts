'use server';

import { redirect } from 'next/navigation';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';

export async function decideMcpAuthorization(formData: FormData): Promise<void> {
  const authorizationId = formData.get('authorization_id');
  const decision = formData.get('decision');
  if (typeof authorizationId !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId)) {
    throw new Error('認証リクエストが不正です');
  }
  if (decision !== 'approve' && decision !== 'deny') throw new Error('認証操作が不正です');

  await getAuthedUser();
  const supabase = await createSessionClient();
  const response = decision === 'approve'
    ? await supabase.auth.oauth.approveAuthorization(authorizationId)
    : await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (response.error || !response.data?.redirect_url) {
    throw new Error('接続の承認を完了できませんでした');
  }
  redirect(response.data.redirect_url);
}

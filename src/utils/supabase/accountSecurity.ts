import 'server-only';
import { getAuthedUser, createSessionClient } from './auth';
import { serviceRoleForServerSessions } from './serviceRole';
import { UserFacingError } from '@/utils/errors';

/** Invalidate other application sessions and Auth refresh tokens before account changes. */
export async function prepareAccountSecurityChange() {
  const actor = await getAuthedUser();
  const { error } = await serviceRoleForServerSessions().from('user_session_activity')
    .update({ revoked_at: new Date().toISOString() }).eq('user_id', actor.id)
    .neq('auth_session_id', actor.sessionId).is('revoked_at', null);
  if (error) throw new UserFacingError('他端末のセッションを失効できませんでした。再度お試しください');
  const supabase = await createSessionClient();
  const { error: authError } = await supabase.auth.signOut({ scope: 'others' });
  if (authError) throw new UserFacingError('他端末のセッションを失効できませんでした。再度お試しください');
  return actor;
}

'use server';

import { z } from 'zod';
import { assertOwner, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';

const inputSchema = z.object({
  orgId: z.uuid(), targetUserId: z.uuid(), reauthToken: z.string().min(1).max(1024),
});

/** DB内で再認証消費・対象のみの昇格・監査保存を同一トランザクションにする。 */
export async function addOrganizationOwner(orgId: string, targetUserId: string, reauthToken: string) {
  return withActionResult('addOrganizationOwner', async () => {
    const { userId } = await assertOwner(orgId);
    const input = inputSchema.safeParse({ orgId, targetUserId, reauthToken });
    if (!input.success) throw new ExpectedActionError('VALIDATION_ERROR', 'オーナー追加の入力が不正です');
    if (userId === targetUserId) throw new ExpectedActionError('VALIDATION_ERROR', '自分をオーナーに追加することはできません');
    const supabase = await createSessionClient();
    const { data: member, error: memberError } = await supabase.from('organization_members')
      .select('role').eq('organization_id', orgId).eq('user_id', targetUserId).maybeSingle();
    if (memberError) throw sanitizeDbError(memberError, 'owner.add.target', { organizationId: orgId });
    if (!member || member.role !== 'member') throw new ExpectedActionError('VALIDATION_ERROR', '追加対象はこの事業所の参加済みメンバーを選んでください');
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('deleted_at').eq('id', targetUserId).maybeSingle();
    if (profileError) throw sanitizeDbError(profileError, 'owner.add.profile', { organizationId: orgId });
    if (!profile || profile.deleted_at) throw new ExpectedActionError('NOT_FOUND', 'このメンバーは現在利用できません');

    // Action側で先にgrantを消費しない。直接RPCからの呼出しもDBが検証する。
    const { error } = await supabase.rpc('add_organization_owner_atomic', {
      p_org_id: orgId, p_target_user_id: targetUserId, p_reauth_token: reauthToken,
    });
    if (error?.message === 'owner_add_requires_reauthentication') throw new ExpectedActionError('REAUTH_REQUIRED', '再認証証明が無効または使用済みです。もう一度再認証してください');
    if (error?.message === 'invalid_owner_add_target') throw new ExpectedActionError('VALIDATION_ERROR', '追加対象はこの事業所の利用可能な参加済みメンバーを選んでください');
    if (error?.message === 'owner_required') throw new ExpectedActionError('FORBIDDEN', 'オーナーの追加は現在のオーナーのみ実行できます');
    if (error) throw sanitizeDbError(error, 'owner.add', { organizationId: orgId });
    return { success: true };
  });
}

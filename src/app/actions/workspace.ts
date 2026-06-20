'use server';

import { getAuthedUser, getAuthedUserFromAccessToken, supabaseAdmin, type OrgRole } from '@/utils/supabase/auth';

export type WorkspaceSummary = {
  id: string;
  name: string;
  role: OrgRole;
};

export type WorkspaceResult =
  | { status: 'success'; workspaces: WorkspaceSummary[]; currentOrganizationId: string | null }
  | { status: 'no_membership'; workspaces: []; currentOrganizationId: null }
  | { status: 'session_expired'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

const VALID_ROLES: OrgRole[] = ['owner', 'manager', 'staff'];

/**
 * ログイン直後の所属解決をRLSの成否に依存させないための境界。
 * 本人性とサーバー管理セッションを検証した後、その本人の所属だけを返す。
 */
export async function getMyWorkspaces(accessToken?: string): Promise<WorkspaceResult> {
  let userId: string;
  try {
    try {
      userId = (await getAuthedUser()).id;
    } catch (cookieError) {
      if (!accessToken) throw cookieError;
      userId = (await getAuthedUserFromAccessToken(accessToken)).id;
    }
  } catch (error) {
    console.warn('workspace session validation failed', error);
    return { status: 'session_expired', message: 'セッションの有効期限が切れています。再度ログインしてください。' };
  }

  try {
    const [{ data: members, error: memberError }, { data: profile, error: profileError }] = await Promise.all([
      supabaseAdmin
        .from('organization_members')
        .select('organization_id, role, organizations!inner(id, name)')
        .eq('user_id', userId),
      supabaseAdmin
        .from('profiles')
        .select('last_organization_id')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    if (memberError || profileError) {
      console.error('workspace lookup failed', { memberError, profileError, userId });
      return { status: 'error', message: '所属情報を取得できませんでした。時間をおいて再試行してください。' };
    }

    if (!members?.length) {
      return { status: 'no_membership', workspaces: [], currentOrganizationId: null };
    }

    const workspaces: WorkspaceSummary[] = [];
    for (const member of members) {
      const organization = Array.isArray(member.organizations)
        ? member.organizations[0]
        : member.organizations;
      if (!organization || !VALID_ROLES.includes(member.role as OrgRole)) {
        console.error('invalid workspace membership', { userId, membership: member });
        return { status: 'forbidden', message: '所属情報または権限設定に不整合があります。管理者へ連絡してください。' };
      }
      workspaces.push({ id: organization.id, name: organization.name, role: member.role as OrgRole });
    }

    return {
      status: 'success',
      workspaces,
      currentOrganizationId: profile?.last_organization_id ?? null,
    };
  } catch (error) {
    console.error('unexpected workspace lookup failure', error);
    return { status: 'error', message: '所属情報を取得できませんでした。時間をおいて再試行してください。' };
  }
}

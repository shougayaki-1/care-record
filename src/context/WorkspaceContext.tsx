'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
// useRouterは使用していなかったので削除
import { CircularProgress, Box } from '@mui/material';
import { setLastOrganization } from '@/app/actions/user';
import { mergePermissions, FULL_PERMISSIONS, type RolePermissions } from '@/utils/permissions';

export type OrganizationRole = 'owner' | 'member';

export type Workspace = {
  id: string;
  name: string;
  role: OrganizationRole;
  effectivePermissions: RolePermissions;
};

// Supabaseからの返り値の型定義
export type WorkspaceLoadStatus = 'loading' | 'ready' | 'no_membership' | 'session_expired' | 'forbidden' | 'error';

type WorkspaceContextType = {
  currentOrg: Workspace | null;
  orgList: Workspace[];
  switchOrg: (orgId: string) => void;
  refreshWorkspace: () => Promise<void>;
  loading: boolean;
  status: WorkspaceLoadStatus;
  errorMessage: string | null;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentOrg, setCurrentOrg] = useState<Workspace | null>(null);
  const [orgList, setOrgList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WorkspaceLoadStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // INITIAL_SESSIONを初回読み込みの唯一の起点にし、二重取得による状態上書きを防ぐ。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[WorkspaceProvider] Auth event: ${event}`);
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Authの内部ロック解放後に読み込む。コールバック内でAuth APIを再入させない。
        setTimeout(() => void fetchWorkspaces(session), 0);
      } else if (event === 'SIGNED_OUT') {
        // トークン更新中の一時イベントで正常な表示を消さないよう、現在値を再確認する。
        setTimeout(() => void (async () => {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (currentSession) {
            await fetchWorkspaces(currentSession);
            return;
          }
          setCurrentOrg(null);
          setOrgList([]);
          setLoading(false);
          setStatus('session_expired');
          setErrorMessage(null);
        })(), 0);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchWorkspaces = async (knownSession?: Session | null) => {
    try {
      setLoading(true);
      setStatus('loading');
      setErrorMessage(null);
      const sessionResult = knownSession === undefined
        ? await supabase.auth.getSession()
        : { data: { session: knownSession }, error: null };
      const { data: { session }, error: sessionError } = sessionResult;
      if (sessionError || !session?.user) {
        setOrgList([]);
        setCurrentOrg(null);
        setStatus('session_expired');
        setErrorMessage('セッションを確認できませんでした。再度ログインしてください。');
        return;
      }

      // 本人のJWTを使ったRLS付きクエリ。Server ActionのCookie反映競合を避ける。
      const [{ data: members, error: memberError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from('organization_members')
          .select('organization_id, role, organizations!inner(id, name)')
          .eq('user_id', session.user.id),
        supabase
          .from('profiles')
          .select('last_organization_id')
          .eq('id', session.user.id)
          .maybeSingle(),
      ]);

      if (memberError || profileError) {
        console.error('Workspace lookup failed', { memberError, profileError });
        setStatus('error');
        setErrorMessage('所属情報を取得できませんでした。時間をおいて再試行してください。');
        return;
      }

      const list: Workspace[] = [];
      for (const member of members ?? []) {
        const organization = Array.isArray(member.organizations)
          ? member.organizations[0]
          : member.organizations;
        const role = member.role as string;
        if (!organization || !['owner', 'member'].includes(role)) {
          setStatus('forbidden');
          setErrorMessage('所属情報または権限設定に不整合があります。管理者へ連絡してください。');
          return;
        }

        let effectivePermissions: RolePermissions;
        if (role === 'owner') {
          effectivePermissions = FULL_PERMISSIONS;
        } else {
          const { data: roleLinks } = await supabase
            .from('organization_member_roles')
            .select('organization_roles(permissions)')
            .eq('organization_id', organization.id)
            .eq('user_id', session.user.id);
          const rolePerms: RolePermissions[] = (roleLinks ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((r: any) => {
              const org = Array.isArray(r.organization_roles) ? r.organization_roles[0] : r.organization_roles;
              return org?.permissions as RolePermissions | undefined;
            })
            .filter((p): p is RolePermissions => p != null);
          effectivePermissions = mergePermissions(rolePerms);
        }

        list.push({ id: organization.id, name: organization.name, role: role as OrganizationRole, effectivePermissions });
      }

      if (list.length === 0) {
        setOrgList([]);
        setCurrentOrg(null);
        setStatus('no_membership');
        return;
      }

      setOrgList(list);
      const target = list.find(o => o.id === profile?.last_organization_id) || list[0];
      setCurrentOrg(target);
      setStatus('ready');
    } catch (error) {
      console.error('Workspace fetch error:', error);
      setStatus('error');
      setErrorMessage('所属情報を取得できませんでした。時間をおいて再試行してください。');
    } finally {
      setLoading(false);
    }
  };

  const refreshWorkspace = async () => {
    await fetchWorkspaces();
  };

  const switchOrg = async (orgId: string) => {
    const target = orgList.find(o => o.id === orgId);
    if (target) {
      setCurrentOrg(target);
      await setLastOrganization(orgId);
      window.location.href = '/app'; 
    }
  };

  if (loading) {
    return <Box height="100vh" display="flex" justifyContent="center" alignItems="center"><CircularProgress /></Box>;
  }

  return (
    <WorkspaceContext.Provider value={{ currentOrg, orgList, switchOrg, refreshWorkspace, loading, status, errorMessage }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};

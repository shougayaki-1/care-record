'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { usePathname } from 'next/navigation';
import { CircularProgress, Box } from '@mui/material';
import { setLastOrganization } from '@/app/actions/user';
import { ensureSessionActivity } from '@/app/actions/auth';
import { FULL_PERMISSIONS, mergePermissions, type RolePermissions } from '@/utils/permissions';

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
  userId: string | null;
  loading: boolean;
  status: WorkspaceLoadStatus;
  errorMessage: string | null;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();
  const shouldLoadWorkspace = pathname.startsWith('/app') || pathname.startsWith('/super-admin');
  const fetchSeq = useRef(0);
  const [currentOrg, setCurrentOrg] = useState<Workspace | null>(null);
  const [orgList, setOrgList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(shouldLoadWorkspace);
  const [status, setStatus] = useState<WorkspaceLoadStatus>(shouldLoadWorkspace ? 'loading' : 'session_expired');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async (knownSession?: Session | null) => {
    const seq = ++fetchSeq.current;
    const isCurrent = () => seq === fetchSeq.current;
    try {
      setLoading(true);
      setStatus('loading');
      setErrorMessage(null);
      const sessionResult = knownSession === undefined
        ? await supabase.auth.getSession()
        : { data: { session: knownSession }, error: null };
      const { data: { session }, error: sessionError } = sessionResult;
      if (sessionError || !session?.user) {
        if (!isCurrent()) return;
        setOrgList([]);
        setCurrentOrg(null);
        setUserId(null);
        setStatus('session_expired');
        setErrorMessage('セッションを確認できませんでした。再度ログインしてください。');
        return;
      }

      // デプロイ前ログインのセッションが user_session_activity に未登録の場合に備えて登録する。
      // getAuthedUser が呼ばれる前に完了させる必要があるため await する。
      await ensureSessionActivity(session.access_token);
      if (!isCurrent()) return;
      setUserId(session.user.id);

      // 本人のJWTを使ったRLS付きクエリ。Server ActionのCookie反映競合を避ける。
      // organization_member_roles を JOIN することで 3RTT → 2RTT に削減。
      const [{ data: members, error: memberError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from('organization_members')
          .select('organization_id, role, organizations!inner(id, name), organization_member_roles(organization_roles(permissions))')
          .eq('user_id', session.user.id),
        supabase
          .from('profiles')
          .select('last_organization_id')
          .eq('id', session.user.id)
          .maybeSingle(),
      ]);

      if (memberError || profileError) {
        if (!isCurrent()) return;
        console.error('Workspace lookup failed', { memberError, profileError });
        const authErr = memberError || profileError;
        if (authErr?.code === '401' || authErr?.message?.toLowerCase().includes('jwt')) {
          setOrgList([]);
          setCurrentOrg(null);
          setUserId(null);
          setStatus('session_expired');
          setErrorMessage('セッションを確認できませんでした。再度ログインしてください。');
        } else {
          setStatus('error');
          setErrorMessage('所属情報を取得できませんでした。時間をおいて再試行してください。');
        }
        return;
      }

      const parsedMembers = (members ?? []).map((member) => {
        const organization = Array.isArray(member.organizations)
          ? member.organizations[0]
          : member.organizations;
        const role = member.role as string;
        const memberRoles = member.organization_member_roles ?? [];
        return { organization, role, memberRoles };
      });

      if (parsedMembers.some(({ organization, role }) => !organization || !['owner', 'member'].includes(role))) {
        if (!isCurrent()) return;
        setStatus('forbidden');
        setErrorMessage('所属情報または権限設定に不整合があります。管理者へ連絡してください。');
        return;
      }

      const list: Workspace[] = [];
      for (const { organization, role, memberRoles } of parsedMembers) {
        const rolePerms: RolePermissions[] = memberRoles.flatMap((omr: { organization_roles: { permissions: RolePermissions } | { permissions: RolePermissions }[] | null }) => {
          const orgRole = Array.isArray(omr.organization_roles) ? omr.organization_roles[0] : omr.organization_roles;
          if (!orgRole?.permissions) return [];
          return [orgRole.permissions as RolePermissions];
        });
        const effectivePermissions = role === 'owner' ? FULL_PERMISSIONS : mergePermissions(rolePerms);

        list.push({ id: organization.id, name: organization.name, role: role as OrganizationRole, effectivePermissions });
      }

      if (list.length === 0) {
        if (!isCurrent()) return;
        setOrgList([]);
        setCurrentOrg(null);
        setStatus('no_membership');
        return;
      }

      if (!isCurrent()) return;
      setOrgList(list);
      const target = list.find(o => o.id === profile?.last_organization_id) || list[0];
      setCurrentOrg(target);
      setStatus('ready');
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Workspace fetch error:', error);
      setStatus('error');
      setErrorMessage('所属情報を取得できませんでした。時間をおいて再試行してください。');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shouldLoadWorkspace) {
      fetchSeq.current += 1;
      setCurrentOrg(null);
      setOrgList([]);
      setUserId(null);
      setLoading(false);
      setStatus('session_expired');
      setErrorMessage(null);
      return;
    }

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
          setUserId(null);
          setLoading(false);
          setStatus('session_expired');
          setErrorMessage(null);
        })(), 0);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchWorkspaces, shouldLoadWorkspace]);

  const refreshWorkspace = useCallback(async () => {
    await fetchWorkspaces();
  }, [fetchWorkspaces]);

  const switchOrg = useCallback(async (orgId: string) => {
    const target = orgList.find(o => o.id === orgId);
    if (target) {
      setCurrentOrg(target);
      await setLastOrganization(orgId);
      window.location.href = '/app'; 
    }
  }, [orgList]);

  const contextValue = useMemo(() => ({
    currentOrg,
    orgList,
    switchOrg,
    refreshWorkspace,
    userId,
    loading,
    status,
    errorMessage,
  }), [currentOrg, orgList, switchOrg, refreshWorkspace, userId, loading, status, errorMessage]);

  if (loading) {
    return <Box height="100vh" display="flex" justifyContent="center" alignItems="center"><CircularProgress /></Box>;
  }

  return (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};

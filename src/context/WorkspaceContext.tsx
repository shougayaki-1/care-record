'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
// useRouterは使用していなかったので削除
import { CircularProgress, Box } from '@mui/material';
import { setLastOrganization } from '@/app/actions/user';

export type OrganizationRole = 'owner' | 'manager' | 'staff';

export type Workspace = {
  id: string;
  name: string;
  role: OrganizationRole;
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
    // 初回読み込み
    fetchWorkspaces();

    // 認証状態の変化を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      console.log(`[WorkspaceProvider] Auth event: ${event}`);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Authの内部ロック解放後に読み込む。コールバック内でAuth APIを再入させない。
        setTimeout(() => void fetchWorkspaces(), 0);
      } else if (event === 'SIGNED_OUT') {
        setCurrentOrg(null);
        setOrgList([]);
        setLoading(false);
        setStatus('session_expired');
        setErrorMessage(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchWorkspaces = async () => {
    try {
      setLoading(true);
      setStatus('loading');
      setErrorMessage(null);
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
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
        if (!organization || !['owner', 'manager', 'staff'].includes(member.role)) {
          setStatus('forbidden');
          setErrorMessage('所属情報または権限設定に不整合があります。管理者へ連絡してください。');
          return;
        }
        list.push({ id: organization.id, name: organization.name, role: member.role as OrganizationRole });
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
    <WorkspaceContext.Provider value={{ currentOrg, orgList, switchOrg, refreshWorkspace: fetchWorkspaces, loading, status, errorMessage }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
// useRouterは使用していなかったので削除
import { CircularProgress, Box } from '@mui/material';
import { setLastOrganization } from '@/app/actions/user';
import { getMyWorkspaces } from '@/app/actions/workspace';

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
        fetchWorkspaces();
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
      const { data: { session } } = await supabase.auth.getSession();
      const result = await getMyWorkspaces(session?.access_token);

      if (result.status === 'success') {
        const list: Workspace[] = result.workspaces;
        setOrgList(list);
        const lastOrgId = result.currentOrganizationId;
        const target = list.find(o => o.id === lastOrgId) || list[0];
        setCurrentOrg(target);
        setStatus('ready');
      } else {
        setOrgList([]);
        setCurrentOrg(null);
        setStatus(result.status);
        setErrorMessage('message' in result ? result.message : null);
      }
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

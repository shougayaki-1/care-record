'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { CircularProgress, Box } from '@mui/material';

export type OrganizationRole = 'owner' | 'manager' | 'staff';

export type Workspace = {
  id: string;
  name: string;
  role: OrganizationRole;
};

// Supabaseからの返り値の型定義
type OrgMemberResponse = {
  role: string;
  organization_id: string;
  organizations: {
    id: string;
    name: string;
  } | null;
};

type WorkspaceContextType = {
  currentOrg: Workspace | null;
  orgList: Workspace[];
  switchOrg: (orgId: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  loading: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentOrg, setCurrentOrg] = useState<Workspace | null>(null);
  const [orgList, setOrgList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // onAuthStateChange に一本化。
    // INITIAL_SESSION も処理することで、Googleログイン直後のCookie→セッション伝播を確実に受け取る。
    // （getSession() はlocalStorageを参照するためCookieベースのセッションを取れないケースがある）
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[WorkspaceProvider] Auth event: ${event}, session: ${!!session}`);

      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        if (session) {
          fetchWorkspaces(session.user.id);
        } else {
          // INITIAL_SESSION でセッションなし = 未ログイン確定
          setCurrentOrg(null);
          setOrgList([]);
          setLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setCurrentOrg(null);
        setOrgList([]);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // user.id を引数で受け取ることで getSession()/getUser() の二重呼び出しを排除
  const fetchWorkspaces = async (userId: string) => {
    try {
      setLoading(true);
      console.log('[WorkspaceProvider] Fetching for user:', userId);

      const [membersRes, profileRes] = await Promise.all([
        supabase
          .from('organization_members')
          .select('role, organization_id, organizations (id, name)')
          .eq('user_id', userId),
        supabase
          .from('profiles')
          .select('last_organization_id')
          .eq('id', userId)
          .maybeSingle(),
      ]);

      if (membersRes.error) throw membersRes.error;

      const members = membersRes.data as unknown as OrgMemberResponse[];

      if (members && members.length > 0) {
        const list: Workspace[] = members
          .filter(m => m.organizations)
          .map((m) => ({
            id: m.organizations!.id,
            name: m.organizations!.name,
            role: m.role as OrganizationRole,
          }));

        setOrgList(list);

        const lastOrgId = profileRes.data?.last_organization_id;
        const target = list.find(o => o.id === lastOrgId) || list[0];
        setCurrentOrg(target);
      } else {
        setOrgList([]);
        setCurrentOrg(null);
      }
    } catch (error) {
      console.error('Workspace fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchOrg = async (orgId: string) => {
    const target = orgList.find(o => o.id === orgId);
    if (target) {
      setCurrentOrg(target);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ last_organization_id: orgId }).eq('id', user.id);
      }
      router.push('/app');
    }
  };

  // refreshWorkspace は外部から呼べるようにするため、getUser() で userId を取得してから委譲
  const refreshWorkspace = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await fetchWorkspaces(user.id);
  };

  if (loading) {
    return <Box height="100vh" display="flex" justifyContent="center" alignItems="center"><CircularProgress /></Box>;
  }

  return (
    <WorkspaceContext.Provider value={{ currentOrg, orgList, switchOrg, refreshWorkspace, loading }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
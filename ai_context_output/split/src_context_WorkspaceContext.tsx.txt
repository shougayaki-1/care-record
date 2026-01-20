'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
// useRouterは使用していなかったので削除
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
  } | null; // Left Join等の可能性を考慮してnull許容
};

type WorkspaceContextType = {
  currentOrg: Workspace | null;
  orgList: Workspace[];
  switchOrg: (orgId: string) => void;
  refreshWorkspace: () => Promise<void>;
  loading: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentOrg, setCurrentOrg] = useState<Workspace | null>(null);
  const [orgList, setOrgList] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('organization_members')
        .select(`
          role,
          organization_id,
          organizations (id, name)
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      // 型アサーションを使用せず、適切な型チェックを行う
      const members = data as unknown as OrgMemberResponse[];

      if (members && members.length > 0) {
        const list: Workspace[] = members
          .filter(m => m.organizations) // 組織が存在するもののみ
          .map((m) => ({
            id: m.organizations!.id,
            name: m.organizations!.name,
            role: m.role as OrganizationRole
          }));
        
        setOrgList(list);

        const { data: profile } = await supabase
          .from('profiles')
          .select('last_organization_id')
          .eq('id', user.id)
          .single();

        const lastOrgId = profile?.last_organization_id;
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
      window.location.href = '/app'; 
    }
  };

  if (loading) {
    return <Box height="100vh" display="flex" justifyContent="center" alignItems="center"><CircularProgress /></Box>;
  }

  return (
    <WorkspaceContext.Provider value={{ currentOrg, orgList, switchOrg, refreshWorkspace: fetchWorkspaces, loading }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
};
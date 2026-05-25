'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { AccountProfile } from '@/types';
import { useToast } from '@/components/ui/ToastProvider';

type MemberRow = { user_id: string; role: string; };
type ProfileRow = { id: string; name: string; email?: string; };
type InvitationRow = { id: string; target_name: string | null; role: string; code: string; };

export function useAccountManager(currentOrg: { id: string; name: string } | null, currentUserId: string) {
  const { showToast } = useToast();
  const [isFetching, setIsFetching] = useState(true);
  const [accountList, setAccountList] = useState<AccountProfile[]>([]);
  
  // 新規招待用
  const [openInvite, setOpenInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('staff');

  // 操作メニュー用
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountProfile | null>(null);

  // ダイアログ用
  const [openRoleDialog, setOpenRoleDialog] = useState(false);
  const [editRole, setEditRole] = useState('staff');
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentOrg) return;
    setIsFetching(true);
    try {
      const { data: membersData } = await supabase.from('organization_members').select('user_id, role').eq('organization_id', currentOrg.id);
      const membersList = (membersData as unknown as MemberRow[]) || [];
      const memberIds = membersList.map((m) => m.user_id);
      
      const profilesMap: Record<string, ProfileRow> = {};
      if (memberIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select('id, name').in('id', memberIds);
        (profilesData as unknown as ProfileRow[] || []).forEach(p => { profilesMap[p.id] = p; });
      }

      const { data: invitationsData } = await supabase.from('invitations').select('*').eq('organization_id', currentOrg.id).eq('is_used', false);

      const mergedList: AccountProfile[] = [];
      
      (invitationsData as unknown as InvitationRow[] || []).forEach((inv) => {
        mergedList.push({ 
            id: inv.id, 
            name: inv.target_name || '名前未設定', 
            role: inv.role, 
            status: 'invited', 
            invitation_code: inv.code 
        });
      });

      membersList.forEach((m) => {
        mergedList.push({ 
            id: m.user_id, 
            name: profilesMap[m.user_id]?.name || '名前未設定', 
            email: profilesMap[m.user_id]?.email, 
            role: m.role, 
            status: 'active' 
        });
      });
      
      mergedList.sort((a, b) => {
          if (a.id === currentUserId) return -1;
          if (b.id === currentUserId) return 1;
          if (a.role === 'owner' && b.role !== 'owner') return -1;
          if (a.role !== 'owner' && b.role === 'owner') return 1;
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (a.status !== 'active' && b.status === 'active') return 1;
          return 0;
      });

      setAccountList(mergedList);
    } catch (e) { 
        console.error(e); 
        showToast('データの取得に失敗しました', 'error');
    } finally {
        setIsFetching(false);
    }
  }, [currentOrg, currentUserId, showToast]);

  const handleGenerateLink = async (baseUrl: string) => {
    if (!currentOrg) return;
    const code = crypto.randomUUID().slice(0, 8);
    await supabase.from('invitations').insert({ 
        organization_id: currentOrg.id, code, created_by: currentUserId, target_name: newInviteName || null, role: newInviteRole 
    });
    setGeneratedLink(`${baseUrl}/join?code=${code}`);
    fetchData(); 
  };

  const handleShare = async () => {
    if (!currentOrg) return;
    if (navigator.share) {
        try { 
          await navigator.share({ 
            title: 'CareRecordへの招待', 
            text: `${currentOrg.name}への招待が届いています。`, 
            url: generatedLink 
          }); 
        } catch (e) { 
          console.error(e); 
        }
    } else { 
        navigator.clipboard.writeText(generatedLink); 
        showToast('リンクをコピーしました'); 
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, account: AccountProfile) => {
      setMenuAnchor(event.currentTarget);
      setSelectedAccount(account);
  };
  
  const handleMenuClose = () => { 
      setMenuAnchor(null); 
  };

  const openRoleEditDialog = () => {
      if (!selectedAccount) return;
      setEditRole(selectedAccount.role);
      setOpenRoleDialog(true);
      handleMenuClose();
  };

  const executeRoleChange = async () => {
      if (!currentOrg || !selectedAccount) return;
      try {
          if (selectedAccount.id === currentUserId && selectedAccount.role === 'owner' && editRole !== 'owner') {
              const ownerCount = accountList.filter(a => a.role === 'owner' && a.status === 'active').length;
              if (ownerCount <= 1) {
                  showToast('あなたは最後のオーナーです。他の人にオーナー権限を付与してから変更してください。', 'error');
                  setOpenRoleDialog(false);
                  return;
              }
          }

          if (selectedAccount.status === 'active') {
              await supabase.from('organization_members').update({ role: editRole }).eq('organization_id', currentOrg.id).eq('user_id', selectedAccount.id);
          } else {
              await supabase.from('invitations').update({ role: editRole }).eq('id', selectedAccount.id);
          }

          showToast('権限を変更しました');
          setOpenRoleDialog(false);
          fetchData();

          if (selectedAccount.id === currentUserId && editRole !== 'owner') {
              // 権限降格時はSPA遷移を妨げないように1秒遅延して一度だけ再ロードを許容
              setTimeout(() => window.location.reload(), 1000);
          }
      } catch (error) { 
          console.error(error); 
          showToast('変更に失敗しました', 'error'); 
      }
  };

  const openDeleteConfirmDialog = () => {
      if (!selectedAccount) return;
      
      if (selectedAccount.id === currentUserId && selectedAccount.role === 'owner') {
          const ownerCount = accountList.filter(a => a.role === 'owner' && a.status === 'active').length;
          if (ownerCount <= 1) {
              showToast('あなたは最後のオーナーのため削除（脱退）できません。', 'error');
              handleMenuClose();
              return;
          }
      }
      
      setOpenDeleteDialog(true);
      handleMenuClose();
  };

  const executeDelete = async () => {
      if (!currentOrg || !selectedAccount) return;

      try {
          if (selectedAccount.status === 'active') {
              const { error } = await supabase.from('organization_members').delete().eq('organization_id', currentOrg.id).eq('user_id', selectedAccount.id);
              if (error) throw error;
              showToast('アカウントを事業所から削除しました');
          } else {
              const { error } = await supabase.from('invitations').delete().eq('id', selectedAccount.id);
              if (error) throw error;
              showToast('招待を取り消しました');
          }
          setOpenDeleteDialog(false);
          fetchData();
      } catch (e) { 
          console.error(e); 
          showToast('エラーが発生しました', 'error'); 
          setOpenDeleteDialog(false);
      }
  };

  return {
    isFetching,
    accountList,
    openInvite,
    setOpenInvite,
    generatedLink,
    setGeneratedLink,
    newInviteName,
    setNewInviteName,
    newInviteRole,
    setNewInviteRole,
    menuAnchor,
    setMenuAnchor,
    selectedAccount,
    setSelectedAccount,
    openRoleDialog,
    setOpenRoleDialog,
    editRole,
    setEditRole,
    openDeleteDialog,
    setOpenDeleteDialog,
    fetchData,
    handleGenerateLink,
    handleShare,
    handleMenuOpen,
    handleMenuClose,
    openRoleEditDialog,
    executeRoleChange,
    openDeleteConfirmDialog,
    executeDelete
  };
}
'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Button, Stack, IconButton, Tooltip, CircularProgress
} from '@mui/material';
import BadgeIcon from '@mui/icons-material/Badge';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';

// 新規作成したモーダルをインポート
import { StaffFormModal } from './_components/StaffFormModal';

type StaffData = { id: string; name: string; user_id: string | null; profiles?: { name: string } | null; };
type AccountData = { id: string; name: string; };

export default function StaffPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  
  const [isFetching, setIsFetching] = useState(true);
  const [staffList, setStaffList] = useState<StaffData[]>([]);
  const [accountList, setAccountList] = useState<AccountData[]>([]);
  
  const [openModal, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState('');
  const [linkedUserId, setLinkedUserId] = useState<string>('none');

  const fetchData = useCallback(async () => {
    if (!currentOrg) return;
    setIsFetching(true);
    try {
      const { data: staffsData, error: staffsError } = await supabase
        .from('staffs')
        .select(`id, name, user_id, profiles(name)`)
        .eq('organization_id', currentOrg.id)
        .order('name', { ascending: true });
        
      if (staffsError) throw staffsError;
      setStaffList((staffsData as unknown as StaffData[]) || []);

      const { data: membersData } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', currentOrg.id);
        
      const accounts: AccountData[] = [];
      if (membersData && membersData.length > 0) {
          const userIds = membersData.map(m => m.user_id);
          const { data: profilesData } = await supabase
              .from('profiles')
              .select('id, name')
              .in('id', userIds);
              
          if (profilesData) {
              profilesData.forEach(p => {
                  accounts.push({ id: p.id, name: p.name });
              });
          }
      }
      setAccountList(accounts);
    } catch (e) { 
        console.error(e); 
        showToast('データの取得に失敗しました', 'error');
    } finally {
        setIsFetching(false);
    }
  }, [currentOrg, showToast]);

  useEffect(() => { if (!wsLoading && currentOrg) fetchData(); }, [wsLoading, currentOrg, fetchData]);

  const handleSave = async (nameInput: string, linkedUserIdInput: string) => {
    if (!currentOrg || !nameInput.trim()) return;
    const finalUserId = linkedUserIdInput === 'none' ? null : linkedUserIdInput;

    try {
        if (editId) {
            await supabase.from('staffs').update({ name: nameInput.trim(), user_id: finalUserId }).eq('id', editId);
            showToast('更新しました');
        } else {
            await supabase.from('staffs').insert({ organization_id: currentOrg.id, name: nameInput.trim(), user_id: finalUserId });
            showToast('追加しました');
        }
        fetchData();
    } catch (e) { console.error(e); showToast('保存に失敗しました', 'error'); }
  };

  const handleOpenAdd = () => { setEditId(null); setStaffName(''); setLinkedUserId('none'); setModalOpen(true); };
  const handleOpenEdit = (staff: StaffData) => { setEditId(staff.id); setStaffName(staff.name); setLinkedUserId(staff.user_id || 'none'); setModalOpen(true); };
  const handleDelete = async (id: string, name: string) => {
      if(!confirm(`「${name}」さんを名簿から削除しますか？\n（※過去のシフトや記録の担当者名も消える可能性があります）`)) return;
      try { await supabase.from('staffs').delete().eq('id', id); showToast('削除しました'); fetchData(); } catch (e) { console.error(e); showToast('削除に失敗しました', 'error'); }
  };

  if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <BadgeIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">スタッフ(名簿)管理</Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
        <Box maxWidth="md" mx="auto">
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 3, boxShadow: 'none', border: 'none', bgcolor: 'transparent' }}>
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">現場スタッフ名簿</Typography>
                    <Typography variant="caption" color="text.secondary">シフトや記録に「担当者」として名前が出るスタッフを登録します。</Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd} sx={{ boxShadow: 'none' }}>
                    スタッフを追加
                </Button>
            </Paper>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                <Table>
                    <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>スタッフ名 (シフト表示用)</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>紐付いているアカウント (ログイン用)</TableCell>
                            <TableCell align="center" width="120" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isFetching ? (
                            <TableRow><TableCell colSpan={3} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
                        ) : staffList.length === 0 ? (
                            <TableRow><TableCell colSpan={3} align="center" sx={{ py: 4, color: 'text.secondary' }}>登録がありません</TableCell></TableRow>
                        ) : (
                            staffList.map((staff) => {
                                const profileName = Array.isArray(staff.profiles) ? staff.profiles[0]?.name : staff.profiles?.name;
                                return (
                                    <TableRow key={staff.id} hover sx={{ height: 60 }}>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{staff.name}</TableCell>
                                        <TableCell>
                                            {staff.user_id ? (
                                                <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                                                    <LinkIcon fontSize="small" />
                                                    <Typography variant="body2">{profileName || '不明なアカウント'}</Typography>
                                                </Box>
                                            ) : (
                                                <Typography variant="body2" color="text.disabled">なし (転記・代理入力用)</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell align="center">
                                            <Stack direction="row" justifyContent="center" spacing={1}>
                                                <Tooltip title="編集"><IconButton size="small" onClick={() => handleOpenEdit(staff)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                                <Tooltip title="削除"><IconButton size="small" color="error" onClick={() => handleDelete(staff.id, staff.name)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
      </Box>

      {/* 抽出したモーダルコンポーネント */}
      <StaffFormModal 
          open={openModal}
          onClose={() => setModalOpen(false)}
          editId={editId}
          initialName={staffName}
          initialLinkedUserId={linkedUserId}
          accountList={accountList}
          onSave={handleSave}
      />
    </Box>
  );
}
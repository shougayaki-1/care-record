'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, IconButton, Paper, Stack, Tooltip, Switch, FormControlLabel } from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import PeopleIcon from '@mui/icons-material/People';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, AppDialog, AppTextField, DataTable, PageHeader, StatusChip } from '@/components/ui';

type Client = { 
    id: string; 
    name: string; 
    created_at: string; 
    archived_at: string | null; 
};

export default function ClientsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  
  const [clients, setClients] = useState<Client[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [openAdd, setOpenAdd] = useState(false);
  const [newName, setNewName] = useState('');
  
  const [openEdit, setOpenEdit] = useState(false);
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchClients = useCallback(async () => {
    if (!currentOrg) return;
    try {
      let query = supabase
        .from('clients')
        .select('*')
        .eq('organization_id', currentOrg.id)
        .order('created_at', { ascending: false });
      
      // アーカイブフィルタ
      if (!showArchived) {
          query = query.is('archived_at', null);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      setClients(data || []);
    } catch (error) { 
        console.error(error); 
    } finally { 
        setLoading(false); 
    }
  }, [currentOrg, showArchived]);

  useEffect(() => { if (!wsLoading && currentOrg) fetchClients(); }, [wsLoading, currentOrg, fetchClients]);

  const handleAddClient = async () => {
    if (!newName.trim() || !currentOrg) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.from('clients').insert([{ name: newName, organization_id: currentOrg.id }]).select().single();
      if (error) throw error;
      setClients([data, ...clients]);
      setOpenAdd(false);
      setNewName('');
      showToast('登録しました');
      fetchClients(); // リフレッシュ
    } catch (error) { 
        console.error(error); 
        showToast('登録に失敗しました', 'error'); 
    } finally { 
        setIsSubmitting(false); 
    }
  };

  const handleOpenEdit = (client: Client) => { setEditId(client.id); setEditName(client.name); setOpenEdit(true); };

  const handleUpdateClient = async () => {
      if (!editName.trim()) return;
      setIsSubmitting(true);
      try {
          const { error } = await supabase.from('clients').update({ name: editName }).eq('id', editId);
          if (error) throw error;
          setClients(clients.map(c => c.id === editId ? { ...c, name: editName } : c));
          setOpenEdit(false);
          showToast('更新しました');
      } catch (error) { 
          console.error(error); 
          showToast('更新に失敗しました', 'error'); 
      } finally { 
          setIsSubmitting(false); 
      }
  };

  const handleArchive = async (id: string, isArchive: boolean) => {
      try {
          const { error } = await supabase
            .from('clients')
            .update({ archived_at: isArchive ? new Date().toISOString() : null })
            .eq('id', id);
          
          if (error) throw error;
          
          showToast(isArchive ? 'アーカイブしました' : '復元しました');
          fetchClients();
      } catch(e) { 
          console.error(e);
          showToast('エラーが発生しました', 'error'); 
      }
  };

  const handleDelete = async (id: string) => {
      if(!(await confirm({ title: '利用者の削除', message: '本当に削除しますか？\nこの利用者の記録データも全て削除されます。\nこの操作は取り消せません。', confirmText: '削除する', confirmColor: 'error' }))) return;
      try {
          const { error } = await supabase.from('clients').delete().eq('id', id);
          if (error) throw error;
          showToast('完全に削除しました');
          fetchClients();
      } catch(e) { 
          console.error(e);
          showToast('削除できませんでした。権限などを確認してください。', 'error'); 
      }
  };

  const handleGoSettings = (id: string) => { router.push(`/app/clients/${id}`); };

  if (loading || wsLoading) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, md: 3 }, bgcolor: 'background.default' }}>
        <PageHeader
          title={<Stack direction="row" alignItems="center" gap={1}><PeopleIcon color="action" />利用者管理</Stack>}
          actions={<><FormControlLabel control={<Switch checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />} label="アーカイブを表示" /><AppButton startIcon={<AddIcon />} onClick={() => setOpenAdd(true)}>新規登録</AppButton></>}
        />

        <DataTable
          component={Paper}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 3 }}
          rows={clients}
          getRowKey={(client) => client.id}
          getRowSx={(client) => ({ opacity: client.archived_at ? 0.6 : 1, bgcolor: client.archived_at ? 'background.subtle' : 'inherit' })}
          emptyTitle="利用者が登録されていません"
          columns={[
            { key: 'name', header: '利用者氏名', render: (client) => client.name },
            { key: 'status', header: '状態', render: (client) => client.archived_at ? <StatusChip label="アーカイブ" /> : <StatusChip label="有効" tone="success" /> },
            { key: 'actions', header: '操作', align: 'right', render: (client) => (
                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                            {!client.archived_at && (
                                <>
                                    <Tooltip title="氏名を編集"><IconButton size="small" onClick={() => handleOpenEdit(client)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                    <Tooltip title="詳細設定"><IconButton size="small" color="primary" onClick={() => handleGoSettings(client.id)}><SettingsIcon fontSize="small" /></IconButton></Tooltip>
                                </>
                            )}
                            
                            {client.archived_at ? (
                                <>
                                    <Tooltip title="復元"><IconButton size="small" onClick={() => handleArchive(client.id, false)}><UnarchiveIcon /></IconButton></Tooltip>
                                    <Tooltip title="完全削除"><IconButton size="small" color="error" onClick={() => handleDelete(client.id)}><DeleteIcon /></IconButton></Tooltip>
                                </>
                            ) : (
                                <Tooltip title="アーカイブ"><IconButton size="small" onClick={() => handleArchive(client.id, true)}><ArchiveIcon /></IconButton></Tooltip>
                            )}
                        </Stack>
            )},
          ]}
        />
      </Box>

      <AppDialog open={openAdd} onClose={() => setOpenAdd(false)} title="利用者の追加" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenAdd(false)}>キャンセル</AppButton><AppButton loading={isSubmitting} onClick={handleAddClient}>登録</AppButton></>}>
        <AppTextField autoFocus margin="dense" label="利用者氏名" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </AppDialog>

      <AppDialog open={openEdit} onClose={() => setOpenEdit(false)} title="利用者名の変更" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenEdit(false)}>キャンセル</AppButton><AppButton loading={isSubmitting} onClick={handleUpdateClient}>保存</AppButton></>}>
        <AppTextField autoFocus margin="dense" label="利用者氏名" value={editName} onChange={(e) => setEditName(e.target.value)} />
      </AppDialog>
    </Box>
  );
}

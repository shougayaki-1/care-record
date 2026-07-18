'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, IconButton, Stack, Tooltip } from '@/components/ui/mui';
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
import { AppButton, AppDialog, AppTextField, DataTable, PageBody, PageHeader, PageLayout, StatusChip, SwitchField, TablePageSkeleton } from '@/components/ui';
import { createClient, setClientArchived, softDeleteClient, updateClientName } from '@/app/actions/clients';

type Client = {
    id: string;
    name: string;
    created_at: string;
    archived_at: string | null;
    assignments: { staff_id: string }[];
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
        .select('id, name, created_at, archived_at, assignments(staff_id)')
        .eq('organization_id', currentOrg.id)
        .is('deleted_at', null)
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

  useEffect(() => {
    if (!wsLoading && currentOrg) {
      queueMicrotask(() => void fetchClients());
    }
  }, [wsLoading, currentOrg, fetchClients]);

  const handleAddClient = async () => {
    if (!newName.trim() || !currentOrg) return;
    setIsSubmitting(true);
    try {
      const data = await createClient(currentOrg.id, newName);
      setClients([{ ...data, assignments: [] }, ...clients]);
      setOpenAdd(false);
      setNewName('');
      showToast('登録しました');
      router.push(`/app/clients/${data.id}?setup=1`);
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
          const result = await updateClientName(currentOrg!.id, editId, editName);
          setClients(clients.map(c => c.id === editId ? { ...c, name: result.name } : c));
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
          await setClientArchived(currentOrg!.id, id, isArchive);
          
          showToast(isArchive ? 'アーカイブしました' : '復元しました');
          fetchClients();
      } catch(e) { 
          console.error(e);
          showToast('エラーが発生しました', 'error'); 
      }
  };

  const handleDelete = async (id: string) => {
      if(!(await confirm({ title: '利用者の削除', message: 'この利用者を削除状態にしますか？\n介護記録は保持期間中そのまま保存され、通常画面には表示されなくなります。', confirmText: '削除する', confirmColor: 'error' }))) return;
      try {
          await softDeleteClient(currentOrg!.id, id, '利用者管理画面から削除');
          showToast('削除状態にしました');
          fetchClients();
      } catch(e) { 
          console.error(e);
          showToast('削除できませんでした。権限などを確認してください。', 'error'); 
      }
  };

  const handleGoSettings = (id: string) => { router.push(`/app/clients/${id}`); };

  if (loading || wsLoading) return <TablePageSkeleton />;

  return (
    <PageLayout>
      <PageBody>
        <PageHeader
          title={<Stack direction="row" alignItems="center" gap={1}><PeopleIcon color="action" />利用者管理</Stack>}
          actions={<><SwitchField checked={showArchived} onChange={e => setShowArchived(e.target.checked)} label="アーカイブを表示" /><AppButton startIcon={<AddIcon />} onClick={() => setOpenAdd(true)}>新規登録</AppButton></>}
        />

        <DataTable
          rows={clients}
          getRowKey={(client) => client.id}
          getRowSx={(client) => ({ opacity: client.archived_at ? 0.6 : 1, bgcolor: client.archived_at ? 'background.subtle' : 'inherit' })}
          emptyTitle="利用者が登録されていません"
          mobileCardRender={(client) => (
            <Box sx={{ px: 1.5, opacity: client.archived_at ? 0.6 : 1, bgcolor: client.archived_at ? 'background.subtle' : 'background.paper' }}>
              <Stack spacing={1.25}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <PeopleIcon color="action" fontSize="small" />
                      <Box sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{client.name}</Box>
                    </Stack>
                  </Box>
                  {client.archived_at ? <StatusChip label="アーカイブ" /> : <StatusChip label="有効" tone="success" />}
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                  {client.assignments.length === 0
                    ? <StatusChip label="⚠️ 担当未設定" tone="warning" />
                    : <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>担当者 {client.assignments.length}名</Box>
                  }
                </Box>
                <Stack direction="row" justifyContent="flex-end" spacing={0.5} useFlexGap flexWrap="wrap">
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
              </Stack>
            </Box>
          )}
          columns={[
            { key: 'name', header: '利用者氏名', render: (client) => client.name },
            { key: 'status', header: '状態', render: (client) => client.archived_at ? <StatusChip label="アーカイブ" /> : <StatusChip label="有効" tone="success" /> },
            { key: 'assignments', header: '担当者数', render: (client) =>
                client.assignments.length === 0
                  ? <StatusChip label="⚠️ 担当未設定" tone="warning" />
                  : <>{client.assignments.length}名</>
            },
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
      </PageBody>

      <AppDialog open={openAdd} onClose={() => setOpenAdd(false)} title="利用者の追加" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenAdd(false)}>キャンセル</AppButton><AppButton loading={isSubmitting} onClick={handleAddClient}>登録</AppButton></>}>
        <AppTextField autoFocus margin="dense" label="利用者氏名" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </AppDialog>

      <AppDialog open={openEdit} onClose={() => setOpenEdit(false)} title="利用者名の変更" actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenEdit(false)}>キャンセル</AppButton><AppButton loading={isSubmitting} onClick={handleUpdateClient}>保存</AppButton></>}>
        <AppTextField autoFocus margin="dense" label="利用者氏名" value={editName} onChange={(e) => setEditName(e.target.value)} />
      </AppDialog>
    </PageLayout>
  );
}

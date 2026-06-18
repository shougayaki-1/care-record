'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, IconButton, Stack, Tooltip, Switch, FormControlLabel, Chip
} from '@mui/material';
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
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <PeopleIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary" sx={{ flexGrow: 1 }}>利用者管理</Typography>
        <FormControlLabel 
            control={<Switch checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />} 
            label="アーカイブを表示" 
        />
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Box display="flex" justifyContent="flex-end" mb={3}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenAdd(true)}>新規登録</Button>
        </Box>

        <TableContainer component={Paper} variant="outlined">
            <Table>
            <TableHead sx={{ bgcolor: '#f8f9fa' }}>
                <TableRow>
                <TableCell sx={{ fontWeight: 'bold' }}>利用者氏名</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>状態</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {clients.length === 0 ? (
                <TableRow><TableCell colSpan={3} align="center" sx={{ py: 5, color: '#999' }}>登録がありません</TableCell></TableRow>
                ) : (
                clients.map((client) => (
                    <TableRow key={client.id} hover sx={{ opacity: client.archived_at ? 0.6 : 1, bgcolor: client.archived_at ? '#f9f9f9' : 'inherit' }}>
                    <TableCell>{client.name}</TableCell>
                    <TableCell>
                        {client.archived_at ? 
                            <Chip label="アーカイブ" size="small" /> : 
                            <Chip label="有効" color="success" size="small" variant="outlined" />
                        }
                    </TableCell>
                    <TableCell align="right">
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
                    </TableCell>
                    </TableRow>
                ))
                )}
            </TableBody>
            </Table>
        </TableContainer>
      </Box>

      <Dialog open={openAdd} onClose={() => setOpenAdd(false)}>
        <DialogTitle>利用者の追加</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}><TextField autoFocus margin="dense" label="利用者氏名" fullWidth value={newName} onChange={(e) => setNewName(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setOpenAdd(false)}>キャンセル</Button><Button onClick={handleAddClient} variant="contained" disabled={isSubmitting}>登録</Button></DialogActions>
      </Dialog>

      <Dialog open={openEdit} onClose={() => setOpenEdit(false)}>
        <DialogTitle>利用者名の変更</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}><TextField autoFocus margin="dense" label="利用者氏名" fullWidth value={editName} onChange={(e) => setEditName(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setOpenEdit(false)}>キャンセル</Button><Button onClick={handleUpdateClient} variant="contained" disabled={isSubmitting}>保存</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
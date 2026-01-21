'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, IconButton, CircularProgress, Stack, Tooltip 
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import PeopleIcon from '@mui/icons-material/People';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';

type Client = { id: string; name: string; created_at: string; };

export default function ClientsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
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
      const { data, error } = await supabase
        .from('clients').select('*').eq('organization_id', currentOrg.id).order('created_at', { ascending: false });
      if (error) throw error;
      setClients(data || []);
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }, [currentOrg]);

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
    } catch (error) { console.error(error); showToast('登録に失敗しました', 'error'); } finally { setIsSubmitting(false); }
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
      } catch (error) { console.error(error); showToast('更新に失敗しました', 'error'); } finally { setIsSubmitting(false); }
  };

  const handleGoSettings = (id: string) => { router.push(`/app/clients/${id}`); };

  if (loading || wsLoading) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <PeopleIcon sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">利用者管理</Typography>
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
                <TableCell sx={{ fontWeight: 'bold' }}>登録日</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {clients.length === 0 ? (
                <TableRow><TableCell colSpan={3} align="center" sx={{ py: 5, color: '#999' }}>登録がありません</TableCell></TableRow>
                ) : (
                clients.map((client) => (
                    <TableRow key={client.id} hover>
                    <TableCell>{client.name}</TableCell>
                    <TableCell>{new Date(client.created_at).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                            <Tooltip title="氏名を編集"><IconButton size="small" onClick={() => handleOpenEdit(client)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="詳細設定"><IconButton size="small" color="primary" onClick={() => handleGoSettings(client.id)}><SettingsIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="削除"><IconButton size="small" color="default" disabled><DeleteIcon fontSize="small" /></IconButton></Tooltip>
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
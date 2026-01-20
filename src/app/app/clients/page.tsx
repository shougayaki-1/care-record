'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Button, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, IconButton, CircularProgress 
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';

type Client = { id: string; name: string; created_at: string; };

export default function ClientsPage() {
  const router = useRouter();
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // useCallbackで依存関係を解決
  const fetchClients = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', currentOrg.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    if (!wsLoading && currentOrg) fetchClients();
  }, [wsLoading, currentOrg, fetchClients]);

  const handleAddClient = async () => {
    if (!newName.trim() || !currentOrg) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .insert([{ name: newName, organization_id: currentOrg.id }])
        .select()
        .single();
      if (error) throw error;
      setClients([data, ...clients]);
      setOpen(false);
      setNewName('');
    } catch (error) {
      console.error(error);
      alert('登録に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (id: string) => {
    router.push(`/app/clients/${id}`);
  };

  if (loading || wsLoading) return <CircularProgress />;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" mb={3}>
        <Typography variant="h5" fontWeight="bold">利用者管理</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>新規登録</Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>利用者氏名</TableCell>
              <TableCell>登録日</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow><TableCell colSpan={3} align="center">登録がありません</TableCell></TableRow>
            ) : (
              clients.map((client) => (
                <TableRow key={client.id} hover>
                  <TableCell>{client.name}</TableCell>
                  <TableCell>{new Date(client.created_at).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <IconButton color="primary" onClick={() => handleEdit(client.id)}><EditIcon /></IconButton>
                    <IconButton color="error"><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>利用者の追加</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}>
          <TextField autoFocus margin="dense" label="利用者氏名" fullWidth value={newName} onChange={(e) => setNewName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>キャンセル</Button>
          <Button onClick={handleAddClient} variant="contained" disabled={isSubmitting}>登録</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
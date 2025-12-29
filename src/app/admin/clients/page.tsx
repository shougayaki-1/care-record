// app/admin/clients/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  CircularProgress
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// 利用者データの型定義
type Client = {
  id: string;
  name: string;
  created_at: string;
};

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ダイアログ用ステート
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 初回読み込み
  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      // 1. ログイン中のユーザーを取得
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 2. ユーザーの所属する事業所IDを取得
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
        
      if (!profile) return;

      // 3. その事業所の利用者一覧を取得
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddClient = async () => {
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      // ユーザー情報取得
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
      
      if (!profile) return;

      // 利用者をDBに追加
      const { data, error } = await supabase
        .from('clients')
        .insert([{ 
          name: newName, 
          organization_id: profile.organization_id 
        }])
        .select()
        .single();

      if (error) throw error;

      // 画面リストに追加
      setClients([data, ...clients]);
      handleClose();
    } catch (error) {
      console.error('Error adding client:', error);
      alert('登録に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setNewName('');
  };

  // 編集ページへ移動（後で作ります）
  const handleEdit = (id: string) => {
    router.push(`/admin/clients/${id}`);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight="bold">
          利用者管理
        </Typography>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />} 
          onClick={() => setOpen(true)}
        >
          新規登録
        </Button>
      </Box>

      {loading ? (
        <CircularProgress />
      ) : (
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
                <TableRow>
                  <TableCell colSpan={3} align="center">
                    利用者が登録されていません
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow key={client.id} hover>
                    <TableCell>{client.name}</TableCell>
                    <TableCell>{new Date(client.created_at).toLocaleDateString()}</TableCell>
                    <TableCell align="right">
                      <IconButton color="primary" onClick={() => handleEdit(client.id)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton color="error">
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* 新規登録ダイアログ */}
      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>利用者の追加</DialogTitle>
        <DialogContent sx={{ minWidth: 300 }}>
          <TextField
            autoFocus
            margin="dense"
            label="利用者氏名"
            fullWidth
            variant="outlined"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>キャンセル</Button>
          <Button onClick={handleAddClient} variant="contained" disabled={isSubmitting}>
            登録
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
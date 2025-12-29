'use client';

import { useEffect, useState } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, 
  TableContainer, TableHead, TableRow, Chip, Button, 
  Dialog, DialogTitle, DialogContent, DialogActions, 
  TextField, Stack, IconButton, InputAdornment,
  Tabs, Tab, Select, MenuItem, FormControl, InputLabel, Tooltip,
  Alert
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';

// ★ここを本番URLに固定
const BASE_URL = 'https://care-record.vercel.app';

// 型定義
type StaffProfile = {
  id: string; // profiles.id または invitations.id
  name: string;
  role: 'owner' | 'manager' | 'staff';
  status: 'active' | 'invited';
  invitation_code?: string; // 招待コード表示用
};

export default function StaffPage() {
  const { showToast } = useToast();
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [orgId, setOrgId] = useState('');
  
  // 招待作成用
  const [openInvite, setOpenInvite] = useState(false);
  const [inviteMode, setInviteMode] = useState(0); 
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('staff');

  // 招待編集用
  const [openEditInvite, setOpenEditInvite] = useState(false);
  const [editingInviteId, setEditingInviteId] = useState('');
  const [editInviteName, setEditInviteName] = useState('');
  const [editInviteRole, setEditInviteRole] = useState('staff');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase.from('profiles').select('organization_id, role').eq('id', user.id).single();
      if (!profile) return;
      
      setOrgId(profile.organization_id);
      setCurrentUserRole(profile.role);

      // 1. アクティブなスタッフ
      const { data: activeStaff } = await supabase
        .from('profiles')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at', { ascending: true });

      // 2. 招待中（未登録）
      const { data: invitations } = await supabase
        .from('invitations')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .eq('is_used', false);

      const mergedList: StaffProfile[] = [];
      
      // 招待中
      invitations?.forEach((inv: any) => {
        mergedList.push({
          id: inv.id,
          name: inv.target_name || '(招待中・名前未設定)',
          role: inv.role as any,
          status: 'invited',
          invitation_code: inv.code
        });
      });

      // 登録済み
      activeStaff?.forEach((st: any) => {
        mergedList.push({
          id: st.id,
          name: st.name,
          role: st.role as any,
          status: 'active'
        });
      });

      setStaffList(mergedList);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // --- 招待作成 ---
  const handleGenerateLink = async () => {
    if (!orgId) return;
    try {
      const code = crypto.randomUUID().split('-')[0] + crypto.randomUUID().split('-')[1];
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase.from('invitations').insert({
        organization_id: orgId,
        code: code,
        created_by: user?.id,
        target_name: inviteMode === 1 ? newInviteName : null,
        role: newInviteRole
      });

      if (error) throw error;

      // ★修正: 固定URLを使用
      const url = `${BASE_URL}/join?code=${code}`;
      
      setGeneratedLink(url);
      showToast('招待リンクを発行しました', 'success');
      fetchData();
    } catch (error) {
      showToast('発行に失敗しました', 'error');
    }
  };

  // --- 招待キャンセル（削除） ---
  const handleCancelInvite = async (invitationId: string) => {
    if (!confirm('この招待を取り消しますか？\nリンクは無効になります。')) return;
    try {
      const { error } = await supabase.from('invitations').delete().eq('id', invitationId);
      if (error) throw error;
      showToast('招待を取り消しました', 'info');
      fetchData();
    } catch (error) {
      console.error(error);
      showToast('取り消しに失敗しました', 'error');
    }
  };

  // --- 招待編集（モーダルOPEN） ---
  const openEditInviteModal = (staff: StaffProfile) => {
    setEditingInviteId(staff.id);
    setEditInviteName(staff.name === '(招待中・名前未設定)' ? '' : staff.name);
    setEditInviteRole(staff.role);
    setOpenEditInvite(true);
  };

  // --- 招待編集（保存） ---
  const handleUpdateInvite = async () => {
    try {
      const { error } = await supabase.from('invitations').update({
        target_name: editInviteName || null,
        role: editInviteRole
      }).eq('id', editingInviteId);

      if (error) throw error;
      showToast('招待内容を更新しました', 'success');
      setOpenEditInvite(false);
      fetchData();
    } catch (error) {
      showToast('更新に失敗しました', 'error');
    }
  };

  // --- 既存スタッフのロール変更 ---
  const handleChangeStaffRole = async (staffId: string, newRole: string) => {
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', staffId);
      if (error) throw error;
      showToast('権限を変更しました', 'success');
      setStaffList(prev => prev.map(p => p.id === staffId ? { ...p, role: newRole as any } : p));
    } catch (error) {
      showToast('権限変更に失敗しました', 'error');
    }
  };

  // --- リンクコピー用 ---
  const copyInviteLink = (code: string) => {
    // ★修正: 固定URLを使用
    const url = `${BASE_URL}/join?code=${code}`;
    
    navigator.clipboard.writeText(url);
    showToast('招待リンクをコピーしました', 'info');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight="bold">スタッフ管理</Typography>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => { setOpenInvite(true); setGeneratedLink(''); }}>
          スタッフを招待
        </Button>
      </Stack>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e0e0e0' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: '#f9f9f9' }}>
              <TableCell>氏名</TableCell>
              <TableCell>権限</TableCell>
              <TableCell>ステータス</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {staffList.map((staff) => (
              <TableRow key={staff.id}>
                <TableCell sx={{ fontWeight: 'bold' }}>{staff.name}</TableCell>
                
                {/* 権限 (Ownerなら変更可能) */}
                <TableCell>
                  {currentUserRole === 'owner' ? (
                     <Select
                       size="small"
                       value={staff.role}
                       onChange={(e) => {
                         if (staff.status === 'active') {
                           handleChangeStaffRole(staff.id, e.target.value);
                         }
                       }}
                       disabled={staff.status === 'invited'} 
                       sx={{ minWidth: 110, fontSize: 13, height: 32 }}
                     >
                       <MenuItem value="staff">ヘルパー</MenuItem>
                       <MenuItem value="manager">管理者</MenuItem>
                       <MenuItem value="owner">共同代表</MenuItem>
                     </Select>
                  ) : (
                    <Chip label={staff.role} size="small" />
                  )}
                </TableCell>
                
                <TableCell>
                  {staff.status === 'invited' ? (
                    <Chip label="招待中" color="warning" size="small" variant="outlined" />
                  ) : (
                    <Chip label="有効" color="success" size="small" variant="outlined" />
                  )}
                </TableCell>
                
                <TableCell align="right">
                  {staff.status === 'invited' && currentUserRole === 'owner' && (
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Tooltip title="リンクをコピー">
                        <IconButton size="small" onClick={() => copyInviteLink(staff.invitation_code!)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="内容を編集">
                        <IconButton size="small" color="primary" onClick={() => openEditInviteModal(staff)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="招待を取り消す">
                        <IconButton size="small" color="error" onClick={() => handleCancelInvite(staff.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* --- 新規招待ダイアログ --- */}
      <Dialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>スタッフ招待</DialogTitle>
        <DialogContent dividers>
          <Tabs value={inviteMode} onChange={(_, v) => { setInviteMode(v); setGeneratedLink(''); }} sx={{ mb: 2 }}>
            <Tab label="汎用リンク" />
            <Tab label="名前指定リンク" />
          </Tabs>

          <Stack spacing={3}>
            <FormControl fullWidth size="small">
              <InputLabel>付与する権限</InputLabel>
              <Select value={newInviteRole} label="付与する権限" onChange={(e) => setNewInviteRole(e.target.value)}>
                <MenuItem value="staff">ヘルパー (Staff)</MenuItem>
                <MenuItem value="manager">管理者 (Manager)</MenuItem>
                <MenuItem value="owner">共同代表 (Owner)</MenuItem>
              </Select>
            </FormControl>

            {inviteMode === 1 && (
              <TextField 
                label="スタッフ氏名" fullWidth size="small"
                value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} 
              />
            )}

            {!generatedLink ? (
              <Button variant="contained" onClick={handleGenerateLink}>リンクを発行</Button>
            ) : (
              <Stack spacing={1}>
                <Alert severity="success">リンクを発行しました！</Alert>
                <TextField 
                  value={generatedLink} fullWidth 
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}>
                          <ContentCopyIcon />
                        </IconButton>
                      </InputAdornment>
                    )
                  }} 
                />
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenInvite(false)}>閉じる</Button>
        </DialogActions>
      </Dialog>

      {/* --- 招待編集ダイアログ --- */}
      <Dialog open={openEditInvite} onClose={() => setOpenEditInvite(false)} maxWidth="xs" fullWidth>
        <DialogTitle>招待内容の編集</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} mt={1}>
             <TextField 
                label="スタッフ氏名 (任意)" fullWidth size="small"
                placeholder="未設定の場合は空欄"
                value={editInviteName} onChange={(e) => setEditInviteName(e.target.value)} 
              />
             <FormControl fullWidth size="small">
              <InputLabel>権限</InputLabel>
              <Select value={editInviteRole} label="権限" onChange={(e) => setEditInviteRole(e.target.value)}>
                <MenuItem value="staff">ヘルパー</MenuItem>
                <MenuItem value="manager">管理者</MenuItem>
                <MenuItem value="owner">共同代表</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEditInvite(false)}>キャンセル</Button>
          <Button onClick={handleUpdateInvite} variant="contained">保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
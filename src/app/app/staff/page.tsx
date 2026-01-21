'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, 
  IconButton, Select, MenuItem, FormControl, InputLabel, Tooltip
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import BadgeIcon from '@mui/icons-material/Badge';
import EditIcon from '@mui/icons-material/Edit';
import ShareIcon from '@mui/icons-material/Share';
import BadgeIconOutline from '@mui/icons-material/Badge';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

type StaffProfile = { id: string; name: string; role: string; status: 'active' | 'invited'; invitation_code?: string; };
type GhostStaff = { id: string; name: string; };
type MemberRow = { user_id: string; role: string; };
type ProfileRow = { id: string; name: string; };
type InvitationRow = { id: string; target_name: string | null; role: string; code: string; };

export default function StaffPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [ghostStaffList, setGhostStaffList] = useState<GhostStaff[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  const [openInvite, setOpenInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('staff');

  const [openGhost, setOpenGhost] = useState(false);
  const [ghostMode, setGhostMode] = useState<'add' | 'edit'>('add');
  const [ghostId, setGhostId] = useState('');
  const [ghostName, setGhostName] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    };
    fetchUser();
  }, []);

  const fetchData = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const { data: membersData, error: membersError } = await supabase
        .from('organization_members').select('user_id, role').eq('organization_id', currentOrg.id);
      if (membersError) throw membersError;

      const membersList = (membersData as unknown as MemberRow[]) || [];
      const memberIds = membersList.map((m) => m.user_id);
      const profilesMap: Record<string, string> = {};

      if (memberIds.length > 0) {
        const { data: profilesData } = await supabase.from('profiles').select('id, name').in('id', memberIds);
        (profilesData as unknown as ProfileRow[] || []).forEach(p => { profilesMap[p.id] = p.name; });
      }

      const { data: invitationsData } = await supabase.from('invitations').select('*').eq('organization_id', currentOrg.id).eq('is_used', false);

      const mergedList: StaffProfile[] = [];
      (invitationsData as unknown as InvitationRow[] || []).forEach((inv) => {
        mergedList.push({ id: inv.id, name: inv.target_name || '(招待中)', role: inv.role, status: 'invited', invitation_code: inv.code });
      });
      membersList.forEach((m) => {
        mergedList.push({ id: m.user_id, name: profilesMap[m.user_id] || '名前未設定', role: m.role, status: 'active' });
      });
      setStaffList(mergedList);

      const { data: ghosts, error: ghostError } = await supabase
        .from('ghost_staffs').select('id, name').eq('organization_id', currentOrg.id).order('created_at', { ascending: true });
      
      if (ghostError) throw ghostError;
      setGhostStaffList(ghosts || []);

    } catch (e) { console.error('Error fetching staff:', e); }
  }, [currentOrg]);

  useEffect(() => { if (!wsLoading && currentOrg) fetchData(); }, [wsLoading, currentOrg, fetchData]);

  const handleGenerateLink = async () => {
    if (!currentOrg) return;
    const code = crypto.randomUUID().slice(0, 8);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('invitations').insert({ organization_id: currentOrg.id, code, created_by: user?.id, target_name: newInviteName || null, role: newInviteRole });
    setGeneratedLink(`${BASE_URL}/join?code=${code}`);
    fetchData(); 
  };

  const handleChangeRole = async (targetId: string, newRole: string) => {
    if (!currentOrg) return;
    try {
      await supabase.from('organization_members').update({ role: newRole }).eq('organization_id', currentOrg.id).eq('user_id', targetId);
      showToast('権限を変更しました');
      fetchData();
    } catch (error) { console.error(error); showToast('変更に失敗しました', 'error'); }
  };

  const handleDelete = async (staff: StaffProfile) => {
    if (!currentOrg) return;
    const message = staff.status === 'active' ? `本当に「${staff.name}」さんをメンバーから削除しますか？` : `「${staff.name}」さんへの招待を取り消しますか？`;
    if (!confirm(message)) return;
    try {
        if (staff.status === 'active') {
            await supabase.from('organization_members').delete().eq('organization_id', currentOrg.id).eq('user_id', staff.id);
        } else {
            await supabase.from('invitations').delete().eq('id', staff.id);
        }
        showToast('削除しました');
        fetchData();
    } catch (e) { console.error(e); showToast('エラーが発生しました', 'error'); }
  };

  const handleSaveGhost = async () => {
    if (!currentOrg || !ghostName.trim()) return;
    try {
        if (ghostMode === 'add') {
            await supabase.from('ghost_staffs').insert({ organization_id: currentOrg.id, name: ghostName.trim() });
            showToast('追加しました');
        } else {
            await supabase.from('ghost_staffs').update({ name: ghostName.trim() }).eq('id', ghostId);
            showToast('更新しました');
        }
        setGhostName('');
        setOpenGhost(false);
        fetchData();
    } catch (e) { console.error(e); showToast('保存に失敗しました', 'error'); }
  };

  const handleOpenAddGhost = () => { setGhostMode('add'); setGhostName(''); setOpenGhost(true); };
  const handleOpenEditGhost = (ghost: GhostStaff) => { setGhostMode('edit'); setGhostId(ghost.id); setGhostName(ghost.name); setOpenGhost(true); };
  const handleDeleteGhost = async (id: string, name: string) => {
      if(!confirm(`「${name}」さんを削除しますか？`)) return;
      try { await supabase.from('ghost_staffs').delete().eq('id', id); showToast('削除しました'); fetchData(); } catch (e) { console.error(e); showToast('削除に失敗しました', 'error'); }
  };

  const handleShare = async () => {
      if (navigator.share) {
          try { await navigator.share({ title: 'CareRecordへの招待', text: `${currentOrg?.name}への招待が届いています。`, url: generatedLink }); } catch (e) { console.error(e); }
      } else { navigator.clipboard.writeText(generatedLink); showToast('リンクをコピーしました'); }
  };

  if (wsLoading || !currentOrg) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <BadgeIconOutline sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">スタッフ管理</Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4}>
            <Box sx={{ width: { xs: '100%', lg: '60%' }, flex: { lg: 7 } }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#f8f9fa' }}>
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">メンバー</Typography>
                        <Typography variant="caption" color="text.secondary">ログイン可能なユーザー</Typography>
                    </Box>
                    <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => { setOpenInvite(true); setGeneratedLink(''); }}>招待</Button>
                </Paper>
                <TableContainer component={Paper} variant="outlined">
                    <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>氏名</TableCell>
                            <TableCell width="140">権限</TableCell>
                            <TableCell width="100">ステータス</TableCell>
                            <TableCell align="center" width="120">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {staffList.map((staff) => (
                        <TableRow key={staff.id} sx={{ height: 60 }}>
                            <TableCell>{staff.name}</TableCell>
                            <TableCell>
                            {staff.id === currentUserId ? <Chip label={staff.role} size="small" /> : (
                                currentOrg.role === 'owner' && staff.status === 'active' ? (
                                    <FormControl size="small" fullWidth>
                                        <Select value={staff.role} onChange={(e) => handleChangeRole(staff.id, e.target.value)} sx={{ fontSize: '0.875rem', py: 0, height: 32 }}>
                                            <MenuItem value="staff">ヘルパー</MenuItem>
                                            <MenuItem value="manager">管理者</MenuItem>
                                            <MenuItem value="owner">共同代表</MenuItem>
                                        </Select>
                                    </FormControl>
                                ) : <Chip label={staff.role} size="small" />
                            )}
                            </TableCell>
                            <TableCell><Chip label={staff.status === 'active' ? '有効' : '招待中'} color={staff.status === 'active' ? 'success' : 'warning'} size="small" /></TableCell>
                            <TableCell align="center">
                                <Stack direction="row" justifyContent="center" spacing={1}>
                                    {staff.status === 'invited' && staff.invitation_code && (
                                    <Tooltip title="招待リンクをコピー">
                                        <IconButton size="small" onClick={() => { navigator.clipboard.writeText(`${BASE_URL}/join?code=${staff.invitation_code}`); showToast('コピーしました'); }}>
                                            <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    )}
                                    {currentOrg.role === 'owner' && staff.id !== currentUserId && (
                                        <Tooltip title="削除 / 招待取消">
                                            <IconButton size="small" color="error" onClick={() => handleDelete(staff)}><DeleteIcon fontSize="small" /></IconButton>
                                        </Tooltip>
                                    )}
                                </Stack>
                            </TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                    </Table>
                </TableContainer>
            </Box>

            <Box sx={{ width: { xs: '100%', lg: '40%' }, flex: { lg: 5 } }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: '#fff3e0', borderColor: '#ffe0b2' }}>
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">アカウントなし</Typography>
                        <Typography variant="caption" color="text.secondary">転記用スタッフ</Typography>
                    </Box>
                    <Button variant="outlined" color="warning" startIcon={<BadgeIcon />} onClick={handleOpenAddGhost}>追加</Button>
                </Paper>
                <TableContainer component={Paper} variant="outlined">
                    <Table>
                        <TableHead><TableRow><TableCell>表示名</TableCell><TableCell align="center">操作</TableCell></TableRow></TableHead>
                        <TableBody>
                            {ghostStaffList.length === 0 ? (
                                <TableRow><TableCell colSpan={2} align="center" sx={{ color: 'text.secondary', py: 3 }}>登録がありません</TableCell></TableRow>
                            ) : ghostStaffList.map(ghost => (
                                <TableRow key={ghost.id} sx={{ height: 60 }}>
                                    <TableCell>{ghost.name}</TableCell>
                                    <TableCell align="center">
                                        <Stack direction="row" justifyContent="center" spacing={1}>
                                            <IconButton size="small" onClick={() => handleOpenEditGhost(ghost)}><EditIcon fontSize="small" /></IconButton>
                                            <IconButton size="small" color="error" onClick={() => handleDeleteGhost(ghost.id, ghost.name)}><DeleteIcon fontSize="small" /></IconButton>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        </Stack>
      </Box>

      <Dialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="xs" fullWidth>
        <DialogTitle>スタッフ招待</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} alignItems="center">
             {!generatedLink ? (
                 <>
                    <FormControl fullWidth size="small">
                        <InputLabel>権限</InputLabel>
                        <Select label="権限" value={newInviteRole} onChange={(e) => setNewInviteRole(e.target.value)}>
                            <MenuItem value="staff">ヘルパー</MenuItem>
                            <MenuItem value="manager">管理者</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField label="氏名 (任意)" size="small" fullWidth value={newInviteName} onChange={(e) => setNewInviteName(e.target.value)} />
                    <Button variant="contained" onClick={handleGenerateLink} fullWidth>招待リンクを発行</Button>
                 </>
             ) : (
                 <>
                    <Typography variant="body2" textAlign="center">相手にこのQRコードを読み取ってもらうか、<br/>リンクを共有してください。</Typography>
                    <Box component="img" src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(generatedLink)}`} alt="QR Code" sx={{ width: 150, height: 150, border: '1px solid #ddd', p: 1, borderRadius: 2 }} />
                    <TextField value={generatedLink} fullWidth size="small" InputProps={{ readOnly: true, endAdornment: (<IconButton onClick={() => { navigator.clipboard.writeText(generatedLink); showToast('コピーしました'); }}><ContentCopyIcon /></IconButton>) }} />
                    <Button variant="outlined" startIcon={<ShareIcon />} fullWidth onClick={handleShare}>共有メニューを開く</Button>
                 </>
             )}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setOpenInvite(false)}>閉じる</Button></DialogActions>
      </Dialog>

      <Dialog open={openGhost} onClose={() => setOpenGhost(false)}>
          <DialogTitle>{ghostMode === 'add' ? 'スタッフ追加' : '名前の変更'}</DialogTitle>
          <DialogContent>
              <Box minWidth={300} pt={1}>
                {ghostMode === 'add' && <Typography variant="body2" color="text.secondary" paragraph>ログイン機能を持たない、名前だけのスタッフを追加します。</Typography>}
                <TextField autoFocus label="氏名" fullWidth value={ghostName} onChange={e => setGhostName(e.target.value)} />
              </Box>
          </DialogContent>
          <DialogActions><Button onClick={() => setOpenGhost(false)}>キャンセル</Button><Button onClick={handleSaveGhost} variant="contained" disabled={!ghostName.trim()}>保存</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, 
  Chip, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, 
  IconButton, Select, MenuItem, FormControl, InputLabel, Tooltip, Menu, Alert,
  ListItemIcon // ★追加
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import BadgeIcon from '@mui/icons-material/Badge';
import EditIcon from '@mui/icons-material/Edit';
import ShareIcon from '@mui/icons-material/Share';
import BadgeIconOutline from '@mui/icons-material/Badge';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import KeyIcon from '@mui/icons-material/Key';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { transferOwner } from '@/app/actions/organization';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

type StaffProfile = { id: string; name: string; role: string; status: 'active' | 'invited'; invitation_code?: string; };
type GhostStaff = { id: string; name: string; };
type MemberRow = { user_id: string; role: string; };
type ProfileRow = { id: string; name: string; };
type InvitationRow = { id: string; target_name: string | null; role: string; code: string; };

export default function StaffPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace(); // refreshWorkspace削除
  const { showToast } = useToast();
  
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [ghostStaffList, setGhostStaffList] = useState<GhostStaff[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  
  // Modal States
  const [openInvite, setOpenInvite] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [newInviteName, setNewInviteName] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('staff');

  const [openGhost, setOpenGhost] = useState(false);
  const [ghostMode, setGhostMode] = useState<'add' | 'edit'>('add');
  const [ghostId, setGhostId] = useState('');
  const [ghostName, setGhostName] = useState('');

  // Transfer Owner States
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(null);
  const [openTransferConfirm, setOpenTransferConfirm] = useState(false);

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
      
      // Sort: Owner first, then joined, then invited
      mergedList.sort((a, b) => {
          if (a.role === 'owner') return -1;
          if (b.role === 'owner') return 1;
          if (a.status === 'active' && b.status !== 'active') return -1;
          return 0;
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
    const message = staff.status === 'active' ? `本当に「${staff.name}」さんをメンバーから削除（脱退）させますか？` : `「${staff.name}」さんへの招待を取り消しますか？`;
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

  // Transfer Owner Logic
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, staff: StaffProfile) => {
      setMenuAnchor(event.currentTarget);
      setSelectedStaff(staff);
  };
  const handleMenuClose = () => { setMenuAnchor(null); setSelectedStaff(null); };
  
  const handleTransferOwnerClick = () => {
      setMenuAnchor(null);
      setOpenTransferConfirm(true);
  };

  const executeTransferOwner = async () => {
      if (!currentOrg || !selectedStaff) return;
      try {
          await transferOwner(currentOrg.id, currentUserId, selectedStaff.id);
          showToast(`オーナー権限を ${selectedStaff.name} さんに譲渡しました`);
          setOpenTransferConfirm(false);
          // 権限が変わるためリロード推奨
          setTimeout(() => window.location.reload(), 1000);
      } catch(e: unknown) { // ★修正: any -> unknown
          const msg = e instanceof Error ? e.message : String(e);
          showToast(`譲渡に失敗しました: ${msg}`, 'error');
      }
  };

  if (wsLoading || !currentOrg) return null;
  const isOwner = currentOrg.role === 'owner';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
        <BadgeIconOutline sx={{ color: 'action.active', mr: 2 }} />
        <Typography variant="h6" fontWeight="bold" color="text.primary">スタッフ管理</Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4}>
            {/* メンバー一覧 */}
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
                            <TableCell align="center" width="100">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {staffList.map((staff) => (
                        <TableRow key={staff.id} sx={{ height: 60 }}>
                            <TableCell>
                                <Typography variant="body2" fontWeight={staff.id === currentUserId ? 'bold' : 'normal'}>
                                    {staff.name} {staff.id === currentUserId && '(あなた)'}
                                </Typography>
                            </TableCell>
                            <TableCell>
                            {staff.status === 'invited' ? (
                                <Chip label={staff.role} size="small" variant="outlined" />
                            ) : (
                                isOwner && staff.id !== currentUserId ? (
                                    <FormControl size="small" fullWidth variant="standard">
                                        <Select 
                                            value={staff.role} 
                                            onChange={(e) => handleChangeRole(staff.id, e.target.value)} 
                                            disableUnderline
                                            sx={{ fontSize: '0.8125rem' }}
                                        >
                                            <MenuItem value="staff">ヘルパー</MenuItem>
                                            <MenuItem value="manager">管理者</MenuItem>
                                            <MenuItem value="owner" disabled>オーナー</MenuItem>
                                        </Select>
                                    </FormControl>
                                ) : (
                                    <Chip 
                                        label={staff.role === 'owner' ? 'オーナー' : (staff.role === 'manager' ? '管理者' : 'ヘルパー')} 
                                        size="small" 
                                        color={staff.role === 'owner' ? 'primary' : 'default'} 
                                    />
                                )
                            )}
                            </TableCell>
                            <TableCell><Chip label={staff.status === 'active' ? '有効' : '招待中'} color={staff.status === 'active' ? 'success' : 'warning'} size="small" /></TableCell>
                            <TableCell align="center">
                                {staff.status === 'invited' && (
                                    <Tooltip title="招待取消 / 削除">
                                        <IconButton size="small" color="error" onClick={() => handleDelete(staff)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {staff.status === 'active' && staff.id !== currentUserId && isOwner && (
                                    <>
                                        <IconButton size="small" onClick={(e) => handleMenuOpen(e, staff)}>
                                            <MoreVertIcon fontSize="small" />
                                        </IconButton>
                                    </>
                                )}
                            </TableCell>
                        </TableRow>
                        ))}
                    </TableBody>
                    </Table>
                </TableContainer>
            </Box>

            {/* ゴーストスタッフ */}
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

      {/* 招待ダイアログ */}
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

      {/* ゴースト追加・編集ダイアログ */}
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

      {/* 操作メニュー (オーナー用) */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
          <MenuItem onClick={handleTransferOwnerClick} sx={{ color: 'warning.main' }}>
              <ListItemIcon><KeyIcon fontSize="small" color="warning" /></ListItemIcon>
              オーナー権限を譲渡
          </MenuItem>
          <MenuItem onClick={() => { if(selectedStaff) handleDelete(selectedStaff); handleMenuClose(); }} sx={{ color: 'error.main' }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              メンバーから削除
          </MenuItem>
      </Menu>

      {/* オーナー権限譲渡確認ダイアログ */}
      <Dialog open={openTransferConfirm} onClose={() => setOpenTransferConfirm(false)}>
          <DialogTitle>オーナー権限の譲渡</DialogTitle>
          <DialogContent>
              <Alert severity="warning" sx={{ mb: 2 }}>
                  この操作は取り消せません！
              </Alert>
              <Typography variant="body1">
                  本当に <b>{selectedStaff?.name}</b> さんにオーナー権限を譲渡しますか？<br/>
                  譲渡後、あなたは「管理者」権限に降格し、事業所の削除や決済などの全権限を失います。
              </Typography>
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setOpenTransferConfirm(false)}>キャンセル</Button>
              <Button onClick={executeTransferOwner} variant="contained" color="warning">権限を譲渡する</Button>
          </DialogActions>
      </Dialog>
    </Box>
  );
}
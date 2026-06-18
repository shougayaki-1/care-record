'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack,
  IconButton, Tooltip, CircularProgress, Select, MenuItem, FormControl, InputLabel, Autocomplete, Chip
} from '@mui/material';

// 役職の入力候補（自由入力も可）
const POSITION_OPTIONS = ['管理者', 'サービス管理責任者', '常勤', '非常勤', 'ヘルパー', 'サービス提供責任者', '看護師'];
import BadgeIcon from '@mui/icons-material/Badge';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';

type StaffData = { id: string; name: string; positions: string[] | null; user_id: string | null; archived_at: string | null; sort_order: number | null; profiles?: { name: string } | null; };
type AccountData = { id: string; name: string; };

export default function StaffPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  
  const [isFetching, setIsFetching] = useState(true);
  const [staffList, setStaffList] = useState<StaffData[]>([]);
  const [accountList, setAccountList] = useState<AccountData[]>([]);
  
  const [openModal, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffPositions, setStaffPositions] = useState<string[]>([]);
  const [linkedUserId, setLinkedUserId] = useState<string>('none');
  const [showArchived, setShowArchived] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentOrg) return;
    setIsFetching(true);
    try {
      // 1. スタッフ一覧の取得
      const { data: staffsData, error: staffsError } = await supabase
        .from('staffs')
        .select(`id, name, positions, user_id, archived_at, sort_order, profiles(name)`)
        .eq('organization_id', currentOrg.id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
        
      if (staffsError) throw staffsError;
      setStaffList((staffsData as unknown as StaffData[]) || []);

      // 2. メンバーのアカウント一覧を安全に取得 (2段階クエリ)
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

  const handleSave = async () => {
    if (!currentOrg || !staffName.trim()) return;
    const finalUserId = linkedUserId === 'none' ? null : linkedUserId;
    // 重複・空白を除いた役職の配列（複数・自由入力可）
    const finalPositions = Array.from(new Set(staffPositions.map(p => p.trim()).filter(Boolean)));

    try {
        if (editId) {
            await supabase.from('staffs').update({ name: staffName.trim(), positions: finalPositions, user_id: finalUserId }).eq('id', editId);
            showToast('更新しました');
        } else {
            await supabase.from('staffs').insert({ organization_id: currentOrg.id, name: staffName.trim(), positions: finalPositions, user_id: finalUserId });
            showToast('追加しました');
        }
        setModalOpen(false);
        fetchData();
    } catch (e) { console.error(e); showToast('保存に失敗しました', 'error'); }
  };

  const handleOpenAdd = () => { setEditId(null); setStaffName(''); setStaffPositions([]); setLinkedUserId('none'); setModalOpen(true); };
  const handleOpenEdit = (staff: StaffData) => { setEditId(staff.id); setStaffName(staff.name); setStaffPositions(staff.positions || []); setLinkedUserId(staff.user_id || 'none'); setModalOpen(true); };
  const handleDelete = async (id: string, name: string) => {
      if(!(await confirm({ title: 'スタッフの削除', message: `「${name}」さんを名簿から削除しますか？\n（※過去のシフトや記録の担当者名も消える可能性があります）\n※退職者は「削除」ではなく「アーカイブ」を推奨します。`, confirmText: '削除する', confirmColor: 'error' }))) return;
      try { await supabase.from('staffs').delete().eq('id', id); showToast('削除しました'); fetchData(); } catch (e) { console.error(e); showToast('削除に失敗しました', 'error'); }
  };

  // 退職スタッフをアーカイブ（過去の記録・シフトは残したまま、新規割当の選択肢から外す）
  const handleArchive = async (id: string, name: string) => {
      if(!(await confirm({ title: 'スタッフのアーカイブ', message: `「${name}」さんをアーカイブ（退職）しますか？\n過去のシフト・記録はそのまま残り、今後のシフトや記録の担当者選択には表示されなくなります。\n（いつでも復元できます）`, confirmText: 'アーカイブする' }))) return;
      try { await supabase.from('staffs').update({ archived_at: new Date().toISOString() }).eq('id', id); showToast('アーカイブしました'); fetchData(); } catch (e) { console.error(e); showToast('アーカイブに失敗しました', 'error'); }
  };

  const handleRestore = async (id: string) => {
      try { await supabase.from('staffs').update({ archived_at: null }).eq('id', id); showToast('復元しました'); fetchData(); } catch (e) { console.error(e); showToast('復元に失敗しました', 'error'); }
  };

  const activeStaff = staffList.filter(s => !s.archived_at);
  const archivedStaff = staffList.filter(s => s.archived_at);
  const visibleStaff = showArchived ? staffList : activeStaff;

  // 在職スタッフの並び順を入れ替える（PDF・シフト・記録の表示順に反映される）
  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= activeStaff.length) return;

    const reordered = [...activeStaff];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    // 楽観的に画面へ反映（在職分を新しい順に、退職分は末尾）
    setStaffList([...reordered, ...archivedStaff]);

    try {
      // 連番で sort_order を書き込み、順序を確定する
      await Promise.all(reordered.map((s, idx) =>
        supabase.from('staffs').update({ sort_order: idx }).eq('id', s.id)
      ));
    } catch (e) {
      console.error(e);
      showToast('並び替えの保存に失敗しました', 'error');
      fetchData();
    }
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
                    <Typography variant="caption" color="text.secondary">シフトや記録に「担当者」として名前が出るスタッフを登録します。↑↓で並び替えた順序がPDFやシフトの表示順に反映されます。</Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                    {archivedStaff.length > 0 && (
                        <Button
                            variant={showArchived ? 'contained' : 'outlined'}
                            color="inherit"
                            size="small"
                            startIcon={<ArchiveIcon />}
                            onClick={() => setShowArchived(v => !v)}
                            sx={{ boxShadow: 'none' }}
                        >
                            {showArchived ? '退職者を隠す' : `退職者を表示 (${archivedStaff.length})`}
                        </Button>
                    )}
                    <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd} sx={{ boxShadow: 'none' }}>
                        スタッフを追加
                    </Button>
                </Stack>
            </Paper>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                <Table>
                    <TableHead sx={{ bgcolor: '#F0F5FF' }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>スタッフ名 (シフト表示用)</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>役職</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>紐付いているアカウント (ログイン用)</TableCell>
                            <TableCell align="center" width="220" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isFetching ? (
                            <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
                        ) : visibleStaff.length === 0 ? (
                            <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>登録がありません</TableCell></TableRow>
                        ) : (
                            visibleStaff.map((staff) => {
                                // プロフィール名も安全に抽出
                                const profileName = Array.isArray(staff.profiles) ? staff.profiles[0]?.name : staff.profiles?.name;
                                const isArchived = !!staff.archived_at;
                                const activeIndex = isArchived ? -1 : activeStaff.findIndex(s => s.id === staff.id);
                                return (
                                    <TableRow key={staff.id} hover sx={{ height: 60, opacity: isArchived ? 0.6 : 1, bgcolor: isArchived ? '#fafafa' : 'inherit' }}>
                                        <TableCell sx={{ fontWeight: 'bold' }}>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                <span>{staff.name}</span>
                                                {isArchived && <Chip label="退職" size="small" color="default" sx={{ bgcolor: '#e0e0e0' }} />}
                                            </Stack>
                                        </TableCell>
                                        <TableCell>
                                            {staff.positions && staff.positions.length > 0 ? (
                                                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                                    {staff.positions.map((p, i) => (
                                                        <Chip key={i} label={p} size="small" variant="outlined" color="primary" />
                                                    ))}
                                                </Stack>
                                            ) : (
                                                <Typography variant="body2" color="text.disabled">—</Typography>
                                            )}
                                        </TableCell>
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
                                            <Stack direction="row" justifyContent="center" spacing={0.5}>
                                                {!isArchived && (
                                                    <>
                                                        <Tooltip title="上へ"><span><IconButton size="small" disabled={activeIndex <= 0} onClick={() => handleMove(activeIndex, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                                                        <Tooltip title="下へ"><span><IconButton size="small" disabled={activeIndex < 0 || activeIndex >= activeStaff.length - 1} onClick={() => handleMove(activeIndex, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                                                    </>
                                                )}
                                                {isArchived ? (
                                                    <Tooltip title="復元（在職に戻す）"><IconButton size="small" color="primary" onClick={() => handleRestore(staff.id)}><UnarchiveIcon fontSize="small" /></IconButton></Tooltip>
                                                ) : (
                                                    <>
                                                        <Tooltip title="編集"><IconButton size="small" onClick={() => handleOpenEdit(staff)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                                        <Tooltip title="アーカイブ（退職）"><IconButton size="small" color="warning" onClick={() => handleArchive(staff.id, staff.name)}><ArchiveIcon fontSize="small" /></IconButton></Tooltip>
                                                    </>
                                                )}
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

      <Dialog open={openModal} onClose={() => setModalOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontWeight: 'bold' }}>{editId ? 'スタッフの編集' : 'スタッフの追加'}</DialogTitle>
          <DialogContent dividers>
              <Stack spacing={3} pt={1}>
                <TextField autoFocus label="スタッフ名 (表示用)" fullWidth size="small" value={staffName} onChange={e => setStaffName(e.target.value)} required />
                <Autocomplete
                    multiple
                    freeSolo
                    options={POSITION_OPTIONS}
                    value={staffPositions}
                    onChange={(_, newValue) => setStaffPositions(newValue.map(v => v.trim()).filter(Boolean))}
                    renderValue={(value, getItemProps) =>
                        value.map((option, index) => {
                            const { key, ...itemProps } = getItemProps({ index });
                            return <Chip key={key} label={option} size="small" color="primary" {...itemProps} />;
                        })
                    }
                    renderInput={(params) => (
                        <TextField {...params} label="役職 (任意・複数可)" size="small" placeholder="入力してEnter / 候補から選択" helperText="例: 管理者、サービス管理責任者、常勤、非常勤、ヘルパー など（複数登録可・自由入力可）" />
                    )}
                />
                <FormControl fullWidth size="small">
                    <InputLabel>紐付けるアカウント (任意)</InputLabel>
                    <Select value={linkedUserId} onChange={(e) => setLinkedUserId(e.target.value as string)} label="紐付けるアカウント (任意)">
                        <MenuItem value="none"><em>紐付けない (転記・代理入力用)</em></MenuItem>
                        {accountList.map(acc => (
                            <MenuItem key={acc.id} value={acc.id}>{acc.name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Typography variant="caption" color="text.secondary">
                    ※システムにログインして自分で記録をつけるヘルパーの場合は、その人の「アカウント」を紐付けてください。事務員が代わりに記録を打ち込むだけのスタッフの場合は「紐付けない」を選択してください。
                </Typography>
              </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
              <Button onClick={() => setModalOpen(false)} color="inherit">キャンセル</Button>
              <Button onClick={handleSave} variant="contained" disabled={!staffName.trim()} sx={{ boxShadow: 'none' }}>保存</Button>
          </DialogActions>
      </Dialog>
    </Box>
  );
}
'use client';

import { useState, useCallback, useTransition } from 'react';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Stack, Divider,
  IconButton, Tooltip, CircularProgress, LinearProgress, Chip
} from '@/components/ui/mui';
import BadgeIcon from '@mui/icons-material/Badge';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, AppDialog, AppTextField, InnerPageHeader, MultiSelectField, PageBody, PageLayout, PageToolbar, SelectField } from '@/components/ui';
import { useFetchData } from '@/hooks/useFetchData';
import {
  deleteStaffPositionPreset,
  getStaffPositionPresets,
  reorderStaffs,
  saveStaff,
  saveStaffPositionPreset,
  setStaffArchived,
  softDeleteStaff,
  type StaffPositionPreset,
} from '@/app/actions/staffs';

const EMPLOYMENT_TYPE_OPTIONS = ['常勤', '非常勤'] as const;
const WORK_STYLE_OPTIONS = ['兼務', '専従'] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPE_OPTIONS)[number];
type WorkStyle = (typeof WORK_STYLE_OPTIONS)[number];

type StaffData = {
  id: string;
  name: string;
  positions: string[] | null;
  employment_type: string | null;
  work_style: string | null;
  user_id: string | null;
  archived_at: string | null;
  sort_order: number | null;
  profiles?: { name: string } | null;
};
type AccountData = { id: string; name: string; };
type StaffPageData = {
  staffList: StaffData[];
  accountList: AccountData[];
  positionPresets: StaffPositionPreset[];
};
const initialStaffPageData: StaffPageData = {
  staffList: [],
  accountList: [],
  positionPresets: [],
};

export default function StaffPage() {
  const { currentOrg, loading: wsLoading } = useWorkspace();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isPending, startTransition] = useTransition();
  
  
  const [openModal, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffPositions, setStaffPositions] = useState<string[]>([]);
  const [employmentType, setEmploymentType] = useState<EmploymentType>('常勤');
  const [workStyle, setWorkStyle] = useState<WorkStyle>('兼務');
  const [linkedUserId, setLinkedUserId] = useState<string>('none');
  const [showArchived, setShowArchived] = useState(false);
  const [openPositionDialog, setOpenPositionDialog] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');

  const fetchStaffData = useCallback(async (): Promise<StaffPageData> => {
    if (!currentOrg) return initialStaffPageData;
      // 1. スタッフ一覧の取得
      const { data: staffsData, error: staffsError } = await supabase
        .from('staffs')
        .select(`id, name, positions, employment_type, work_style, user_id, archived_at, sort_order, profiles:profiles!user_id(name)`)
        .eq('organization_id', currentOrg.id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
        
      if (staffsError) throw staffsError;

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
      return {
        staffList: (staffsData as unknown as StaffData[]) || [],
        accountList: accounts,
        positionPresets: await getStaffPositionPresets(currentOrg.id),
      };
  }, [currentOrg]);

  const {
    data: staffPageData,
    loading: isFetching,
    refetch: fetchData,
    setData: setStaffPageData,
  } = useFetchData(fetchStaffData, initialStaffPageData, !wsLoading && Boolean(currentOrg), (message) => {
    showToast(`データの取得に失敗しました: ${message}`, 'error');
  });
  const { staffList, accountList, positionPresets } = staffPageData;

  const handleSave = async () => {
    if (!currentOrg || !staffName.trim()) return;
    const finalUserId = linkedUserId === 'none' ? null : linkedUserId;
    // 重複・空白を除いた役職の配列（複数・自由入力可）
    const finalPositions = Array.from(new Set(staffPositions.map(p => p.trim()).filter(Boolean)));

    try {
        await saveStaff(currentOrg.id, {
          staffId: editId,
          name: staffName,
          positions: finalPositions,
          employmentType,
          workStyle,
          linkedUserId: finalUserId,
        });
        showToast(editId ? '更新しました' : '追加しました');
        setModalOpen(false);
        fetchData();
    } catch (e) { console.error(e); showToast('保存に失敗しました', 'error'); }
  };

  const handleOpenAdd = () => { setEditId(null); setStaffName(''); setStaffPositions([]); setEmploymentType('常勤'); setWorkStyle('兼務'); setLinkedUserId('none'); setModalOpen(true); };
  const handleOpenEdit = (staff: StaffData) => {
    setEditId(staff.id);
    setStaffName(staff.name);
    setStaffPositions(staff.positions || []);
    setEmploymentType(EMPLOYMENT_TYPE_OPTIONS.includes(staff.employment_type as EmploymentType) ? staff.employment_type as EmploymentType : '常勤');
    setWorkStyle(WORK_STYLE_OPTIONS.includes(staff.work_style as WorkStyle) ? staff.work_style as WorkStyle : '兼務');
    setLinkedUserId(staff.user_id || 'none');
    setModalOpen(true);
  };
  const handleDelete = async (id: string, name: string) => {
      if(!(await confirm({ title: 'スタッフの削除', message: `「${name}」さんを名簿から削除しますか？\n過去のシフトや記録は法定保存期間中そのまま保持されます。`, confirmText: '削除する', confirmColor: 'error' }))) return;
      try { await softDeleteStaff(currentOrg!.id, id, 'スタッフ管理画面から削除'); showToast('削除しました'); fetchData(); } catch (e) { console.error(e); showToast(e instanceof Error ? e.message : '削除に失敗しました', 'error'); }
  };

  // 退職スタッフをアーカイブ（過去の記録・シフトは残したまま、新規割当の選択肢から外す）
  const handleArchive = async (id: string, name: string) => {
      if(!(await confirm({ title: 'スタッフのアーカイブ', message: `「${name}」さんをアーカイブ（退職）しますか？\n過去のシフト・記録はそのまま残り、今後のシフトや記録の担当者選択には表示されなくなります。\n（いつでも復元できます）`, confirmText: 'アーカイブする' }))) return;
      try { await setStaffArchived(currentOrg!.id, id, true); showToast('アーカイブしました'); fetchData(); } catch (e) { console.error(e); showToast('アーカイブに失敗しました', 'error'); }
  };

  const handleRestore = async (id: string) => {
      try { await setStaffArchived(currentOrg!.id, id, false); showToast('復元しました'); fetchData(); } catch (e) { console.error(e); showToast('復元に失敗しました', 'error'); }
  };

  const handleAddPositionPreset = async () => {
      if (!currentOrg || !newPositionName.trim()) return;
      try {
          await saveStaffPositionPreset(currentOrg.id, newPositionName);
          setNewPositionName('');
          await fetchData();
          showToast('役職プリセットを追加しました');
      } catch (e) {
          console.error(e);
          showToast(e instanceof Error ? e.message : '役職プリセットの追加に失敗しました', 'error');
      }
  };

  const handleDeletePositionPreset = async (presetId: string) => {
      if (!currentOrg) return;
      try {
          await deleteStaffPositionPreset(currentOrg.id, presetId);
          await fetchData();
          showToast('役職プリセットを削除しました');
      } catch (e) {
          console.error(e);
          showToast('役職プリセットの削除に失敗しました', 'error');
      }
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
    startTransition(() => setStaffPageData(prev => ({ ...prev, staffList: [...reordered, ...archivedStaff] })));

    try {
      // 連番で sort_order を書き込み、順序を確定する
      await reorderStaffs(currentOrg!.id, reordered.map(s => s.id));
    } catch (e) {
      console.error(e);
      showToast('並び替えの保存に失敗しました', 'error');
      fetchData();
    }
  };

  if (wsLoading || !currentOrg) return <Box p={5} textAlign="center"><CircularProgress /></Box>;

  return (
    <PageLayout>
      <InnerPageHeader icon={<BadgeIcon />} title="スタッフ(名簿)管理" />

      <PageBody>
            {isPending && <LinearProgress sx={{ mb: 1 }} />}
            <PageToolbar>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight="bold" color="text.primary">現場スタッフ名簿</Typography>
                    <Typography variant="caption" color="text.secondary">シフトや記録に「担当者」として名前が出るスタッフを登録します。↑↓で並び替えた順序がPDFやシフトの表示順に反映されます。</Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" justifyContent={{ xs: 'stretch', sm: 'flex-end' }} sx={{ '& > *': { flex: { xs: '1 1 100%', sm: '0 0 auto' } } }}>
                    {archivedStaff.length > 0 && (
                        <Button
                            variant={showArchived ? 'contained' : 'outlined'}
                            color="inherit"
                            size="small"
                            startIcon={<ArchiveIcon />}
                            onClick={() => startTransition(() => setShowArchived(v => !v))}
                            sx={{ boxShadow: 'none' }}
                        >
                            {showArchived ? '退職者を隠す' : `退職者を表示 (${archivedStaff.length})`}
                        </Button>
                    )}
                    <AppButton startIcon={<AddIcon />} onClick={handleOpenAdd}>
                        スタッフを追加
                    </AppButton>
                    <Button variant="outlined" size="small" onClick={() => setOpenPositionDialog(true)}>
                        役職プリセット
                    </Button>
                </Stack>
            </PageToolbar>

            {isMobile && (
                <Stack divider={<Divider />} sx={{ borderTop: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                    {isFetching ? (
                        <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>
                    ) : visibleStaff.length === 0 ? (
                        <Box sx={{ py: 4, px: 2, textAlign: 'center', color: 'text.secondary' }}>登録がありません</Box>
                    ) : visibleStaff.map((staff) => {
                        const profileName = Array.isArray(staff.profiles) ? staff.profiles[0]?.name : staff.profiles?.name;
                        const isArchived = !!staff.archived_at;
                        const activeIndex = isArchived ? -1 : activeStaff.findIndex(s => s.id === staff.id);

                        return (
                            <Box key={staff.id} sx={{ py: 1.5, opacity: isArchived ? 0.65 : 1, bgcolor: isArchived ? 'background.subtle' : 'background.paper' }}>
                                <Stack spacing={1.25}>
                                    <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
                                        <Box minWidth={0}>
                                            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                                <Typography variant="subtitle2" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{staff.name}</Typography>
                                                {isArchived && <Chip label="退職" size="small" color="default" sx={{ bgcolor: 'background.muted' }} />}
                                            </Stack>
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                                                {staff.user_id ? `紐付き: ${profileName || '不明なアカウント'}` : '紐付きなし (転記・代理入力用)'}
                                            </Typography>
                                        </Box>
                                    </Box>
                                    <Box display="flex" gap={0.75} flexWrap="wrap">
                                        {staff.employment_type ? <Chip label={staff.employment_type} size="small" variant="outlined" /> : <Chip label="雇用形態未設定" size="small" variant="outlined" color="default" />}
                                        {staff.work_style ? <Chip label={staff.work_style} size="small" variant="outlined" /> : <Chip label="専従・兼務未設定" size="small" variant="outlined" color="default" />}
                                        {staff.positions && staff.positions.length > 0 ? (
                                            staff.positions.map((p, i) => <Chip key={i} label={p} size="small" variant="outlined" color="primary" />)
                                        ) : (
                                            <Chip label="役職未設定" size="small" variant="outlined" color="default" />
                                        )}
                                    </Box>
                                    <Stack direction="row" justifyContent="flex-end" spacing={0.5} useFlexGap flexWrap="wrap">
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
                                </Stack>
                            </Box>
                        );
                    })}
                </Stack>
            )}

            <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
                <Table>
                    <TableHead sx={{ bgcolor: 'background.tint' }}>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 'bold' }}>スタッフ名 (シフト表示用)</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>雇用形態</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>専従・兼務</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>役職</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>紐付いているアカウント (ログイン用)</TableCell>
                            <TableCell align="center" width="220" sx={{ fontWeight: 'bold' }}>操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isFetching ? (
                            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
                        ) : visibleStaff.length === 0 ? (
                            <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>登録がありません</TableCell></TableRow>
                        ) : (
                            visibleStaff.map((staff) => {
                                // プロフィール名も安全に抽出
                                const profileName = Array.isArray(staff.profiles) ? staff.profiles[0]?.name : staff.profiles?.name;
                                const isArchived = !!staff.archived_at;
                                const activeIndex = isArchived ? -1 : activeStaff.findIndex(s => s.id === staff.id);
                                return (
                                    <TableRow key={staff.id} hover sx={{ height: 60, opacity: isArchived ? 0.6 : 1, bgcolor: isArchived ? 'background.subtle' : 'inherit' }}>
                                        <TableCell sx={{ fontWeight: 'bold' }}>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                <span>{staff.name}</span>
                                                {isArchived && <Chip label="退職" size="small" color="default" sx={{ bgcolor: 'background.muted' }} />}
                                            </Stack>
                                        </TableCell>
                                        <TableCell>
                                            {staff.employment_type ? <Chip label={staff.employment_type} size="small" variant="outlined" /> : <Typography variant="body2" color="text.disabled">—</Typography>}
                                        </TableCell>
                                        <TableCell>
                                            {staff.work_style ? <Chip label={staff.work_style} size="small" variant="outlined" /> : <Typography variant="body2" color="text.disabled">—</Typography>}
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
      </PageBody>

      <AppDialog open={openModal} onClose={() => setModalOpen(false)} maxWidth="xs" title={editId ? 'スタッフの編集' : 'スタッフの追加'} actions={<><AppButton variant="text" intent="secondary" onClick={() => setModalOpen(false)}>キャンセル</AppButton><AppButton onClick={handleSave} disabled={!staffName.trim()}>保存</AppButton></>}>
              <Stack spacing={3} pt={1}>
                <AppTextField autoFocus label="スタッフ名 (表示用)" value={staffName} onChange={e => setStaffName(e.target.value)} required />
                <SelectField value={employmentType} onChange={(value) => setEmploymentType(value as EmploymentType)} label="雇用形態" options={EMPLOYMENT_TYPE_OPTIONS.map((value) => ({ value, label: value }))} />
                <SelectField value={workStyle} onChange={(value) => setWorkStyle(value as WorkStyle)} label="専従・兼務" options={WORK_STYLE_OPTIONS.map((value) => ({ value, label: value }))} />
                <MultiSelectField
                    options={positionPresets.map((preset) => preset.name)}
                    value={staffPositions}
                    onChange={setStaffPositions}
                    label="役職 (複数可)"
                    placeholder="役職プリセットから選択"
                    helperText="候補は「役職プリセット」から追加できます"
                    getOptionLabel={(name) => name}
                    getOptionValue={(name) => name}
                />
                <SelectField value={linkedUserId} onChange={setLinkedUserId} label="紐付けるアカウント (任意)" options={[{ value: 'none', label: '紐付けない (転記・代理入力用)' }, ...accountList.map((account) => ({ value: account.id, label: account.name }))]} />
                <Typography variant="caption" color="text.secondary">
                    ※システムにログインして自分で記録をつけるヘルパーの場合は、その人の「アカウント」を紐付けてください。事務員が代わりに記録を打ち込むだけのスタッフの場合は「紐付けない」を選択してください。
                </Typography>
              </Stack>
      </AppDialog>

      <AppDialog open={openPositionDialog} onClose={() => setOpenPositionDialog(false)} maxWidth="xs" title="役職プリセット" actions={<AppButton variant="text" intent="secondary" onClick={() => setOpenPositionDialog(false)}>閉じる</AppButton>}>
          <Stack spacing={2} pt={1}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <AppTextField label="新しい役職" value={newPositionName} onChange={(e) => setNewPositionName(e.target.value)} />
                  <AppButton onClick={handleAddPositionPreset} disabled={!newPositionName.trim()}>追加</AppButton>
              </Stack>
              <Stack spacing={1}>
                  {positionPresets.map((preset) => (
                      <Paper key={preset.id} variant="outlined" sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{preset.name}</Typography>
                          <IconButton size="small" color="error" onClick={() => handleDeletePositionPreset(preset.id)}><DeleteIcon fontSize="small" /></IconButton>
                      </Paper>
                  ))}
                  {positionPresets.length === 0 && <Typography variant="body2" color="text.secondary" textAlign="center">役職プリセットがありません</Typography>}
              </Stack>
          </Stack>
      </AppDialog>
    </PageLayout>
  );
}

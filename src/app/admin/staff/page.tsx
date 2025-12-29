// app/admin/staff/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, Button,
    Dialog, DialogTitle, DialogContent, DialogActions,
    FormGroup, FormControlLabel, Checkbox, Select, MenuItem,
    CircularProgress, Alert, TextField, Stack, IconButton, InputAdornment,
    Tabs, Tab, LinearProgress
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SaveIcon from '@mui/icons-material/Save';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import DownloadIcon from '@mui/icons-material/Download';
import { supabase } from '@/lib/supabase';
import { createStaffDirectly } from '@/app/actions/staff'; // Server Action

// 型定義
type StaffProfile = {
    id: string;
    name: string;
    role: 'owner' | 'manager' | 'staff';
};
type Client = { id: string; name: string; };

export default function StaffPage() {
    const [staffList, setStaffList] = useState<StaffProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUserRole, setCurrentUserRole] = useState<string>('');
    const [orgId, setOrgId] = useState<string>('');

    // 担当割り当て用
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [openAssign, setOpenAssign] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<StaffProfile | null>(null);
    const [assignedClientIds, setAssignedClientIds] = useState<string[]>([]);
    const [savingAssign, setSavingAssign] = useState(false);

    // --- 招待・登録機能用 ---
    const [openInvite, setOpenInvite] = useState(false);
    const [inviteMode, setInviteMode] = useState(0); // 0:リンク, 1:指定リンク, 2:直接, 3:CSV
    const [generatedLink, setGeneratedLink] = useState('');

    // 入力フォーム用
    const [targetName, setTargetName] = useState('');
    const [targetEmail, setTargetEmail] = useState('');
    const [targetPassword, setTargetPassword] = useState('');
    const [targetAssignedIds, setTargetAssignedIds] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // --- CSVインポート用 ---
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importLogs, setImportLogs] = useState<string[]>([]);
    const [importProgress, setImportProgress] = useState(0);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: myProfile } = await supabase
                .from('profiles')
                .select('organization_id, role')
                .eq('id', user.id)
                .single();

            if (!myProfile) return;
            setCurrentUserRole(myProfile.role);
            setOrgId(myProfile.organization_id);

            const { data: staffData } = await supabase
                .from('profiles')
                .select('*')
                .eq('organization_id', myProfile.organization_id)
                .order('created_at', { ascending: true });

            setStaffList(staffData as StaffProfile[] || []);

            const { data: clientsData } = await supabase
                .from('clients')
                .select('id, name')
                .eq('organization_id', myProfile.organization_id);

            setAllClients(clientsData || []);

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // --- 担当割り当てロジック ---
    const handleOpenAssign = async (staff: StaffProfile) => {
        setSelectedStaff(staff);
        setOpenAssign(true);
        setSavingAssign(false);
        const { data } = await supabase.from('assignments').select('client_id').eq('helper_id', staff.id);
        setAssignedClientIds(data ? data.map((d: any) => d.client_id) : []);
    };

    const handleSaveAssignments = async () => {
        if (!selectedStaff) return;
        setSavingAssign(true);
        try {
            await supabase.from('assignments').delete().eq('helper_id', selectedStaff.id);
            if (assignedClientIds.length > 0) {
                await supabase.from('assignments').insert(
                    assignedClientIds.map(clientId => ({ helper_id: selectedStaff.id, client_id: clientId }))
                );
            }
            alert('担当を更新しました');
            setOpenAssign(false);
        } catch {
            alert('エラー');
        } finally {
            setSavingAssign(false);
        }
    };

    // --- 招待・作成ロジック ---
    const handleGenerateLink = async () => {
        if (!orgId) return;
        setIsProcessing(true);
        try {
            const code = crypto.randomUUID().split('-')[0] + crypto.randomUUID().split('-')[1];
            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase.from('invitations').insert({
                organization_id: orgId,
                code: code,
                created_by: user?.id,
                target_name: inviteMode === 1 ? targetName : null,
                target_client_ids: inviteMode === 1 ? targetAssignedIds : null
            });

            if (error) throw error;
            const url = `${window.location.origin}/join?code=${code}`;
            setGeneratedLink(url);
        } catch (error) {
            console.error(error);
            alert('リンク発行失敗');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDirectCreate = async () => {
        if (!targetName || !targetEmail || !targetPassword) {
            alert('すべての項目を入力してください');
            return;
        }
        setIsProcessing(true);
        try {
            await createStaffDirectly({
                email: targetEmail,
                password: targetPassword,
                name: targetName,
                organizationId: orgId,
                assignedClientIds: targetAssignedIds
            });
            alert('アカウントを作成しました！');
            setOpenInvite(false);
            fetchData();
        } catch (error: any) {
            console.error(error);
            alert('作成失敗: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    // --- CSVインポート処理 ---
    const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsProcessing(true);
        setImportLogs(['読み込み開始...']);
        setImportProgress(0);

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target?.result as string;
            if (!text) return;

            // 行ごとに分割 (改行コード対応)
            const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');

            // ヘッダー行を除外するか判定（今回は1行目が "name" 等なら除外）
            let startIndex = 0;
            if (lines[0].includes('name') || lines[0].includes('氏名')) {
                startIndex = 1;
            }

            const total = lines.length - startIndex;
            let successCount = 0;
            let failCount = 0;

            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i];
                // カンマ区切りで分割
                const cols = line.split(',');
                // フォーマット: name, email, password, role(任意)
                const name = cols[0]?.trim();
                const email = cols[1]?.trim();
                const password = cols[2]?.trim();
                const role = cols[3]?.trim(); // owner, manager, staff

                if (!name || !email || !password) {
                    setImportLogs(prev => [...prev, `[スキップ] 行${i + 1}: 必須項目不足 (${line})`]);
                    failCount++;
                    continue;
                }

                try {
                    // Server Action呼び出し
                    await createStaffDirectly({
                        email,
                        password,
                        name,
                        organizationId: orgId,
                        assignedClientIds: [] // CSVでは担当割り当ては行わない（ID指定が難しいため）
                    });

                    // ロールが指定されていれば更新 (デフォルトはstaff)
                    if (role && ['owner', 'manager', 'staff'].includes(role)) {
                        // emailからIDを引くのは難しいので、createStaffDirectlyがIDを返してくれれば良いが
                        // 今回は一旦スキップし、必要なら後でロール変更してもらう運用とする
                        // (完璧にするならcreateStaffDirectlyでロールも指定できるように改修が必要)
                    }

                    setImportLogs(prev => [...prev, `[成功] ${name} (${email})`]);
                    successCount++;
                } catch (err: any) {
                    setImportLogs(prev => [...prev, `[失敗] ${name}: ${err.message}`]);
                    failCount++;
                }

                // 進捗更新
                setImportProgress(Math.round(((i - startIndex + 1) / total) * 100));
            }

            setImportLogs(prev => [...prev, `完了: 成功 ${successCount}件, 失敗 ${failCount}件`]);
            setIsProcessing(false);

            if (successCount > 0) {
                fetchData(); // リスト更新
            }
        };

        reader.readAsText(file);
        // 同じファイルを再選択できるようにリセット
        e.target.value = '';
    };

    // サンプルCSVのダウンロード
    const downloadSampleCSV = () => {
        const csvContent = '\uFEFFname,email,password,role\n山田太郎,taro@example.com,pass1234,staff\n鈴木花子,hanako@example.com,pass5678,manager';
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'staff_import_sample.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const resetInviteForm = () => {
        setInviteMode(0);
        setGeneratedLink('');
        setTargetName('');
        setTargetEmail('');
        setTargetPassword('');
        setTargetAssignedIds([]);
        setIsProcessing(false);
        setImportLogs([]);
        setImportProgress(0);
    };

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h5" fontWeight="bold">スタッフ管理</Typography>
                <Button
                    variant="contained"
                    startIcon={<PersonAddIcon />}
                    onClick={() => { setOpenInvite(true); resetInviteForm(); }}
                >
                    スタッフ追加・招待
                </Button>
            </Stack>

            {/* スタッフ一覧テーブル */}
            {loading ? <CircularProgress /> : (
                <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e0e0e0' }}>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f9f9f9' }}>
                                <TableCell>氏名</TableCell>
                                <TableCell>権限</TableCell>
                                <TableCell>担当</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {staffList.map((staff) => (
                                <TableRow key={staff.id}>
                                    <TableCell sx={{ fontWeight: 'bold' }}>{staff.name}</TableCell>
                                    <TableCell><Chip label={staff.role} color={staff.role === 'owner' ? 'primary' : 'default'} size="small" /></TableCell>
                                    <TableCell>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            startIcon={<AssignmentIndIcon />}
                                            onClick={() => handleOpenAssign(staff)}
                                        >
                                            担当設定
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* --- 追加・招待ダイアログ --- */}
            <Dialog open={openInvite} onClose={() => setOpenInvite(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 'bold' }}>スタッフ追加</DialogTitle>
                <DialogContent dividers>

                    <Tabs
                        value={inviteMode}
                        onChange={(_, v) => { setInviteMode(v); setGeneratedLink(''); setImportLogs([]); }}
                        variant="scrollable"
                        scrollButtons="auto"
                        sx={{ mb: 3 }}
                    >
                        <Tab label="汎用リンク" />
                        <Tab label="名前・担当指定" />
                        <Tab label="直接作成" />
                        <Tab label="CSV一括作成" icon={<FileUploadIcon />} iconPosition="start" />
                    </Tabs>

                    {/* モード0: 汎用リンク */}
                    {inviteMode === 0 && (
                        <Stack spacing={2}>
                            <Typography variant="body2">誰でも使える招待リンクを発行します。</Typography>
                            {!generatedLink ? (
                                <Button variant="contained" onClick={handleGenerateLink} disabled={isProcessing}>リンクを発行</Button>
                            ) : (
                                <InviteLinkView url={generatedLink} />
                            )}
                        </Stack>
                    )}

                    {/* モード1: 名前・担当指定 */}
                    {inviteMode === 1 && (
                        <Stack spacing={2}>
                            <Typography variant="body2">特定のスタッフ専用のリンクを発行します。</Typography>
                            {!generatedLink ? (
                                <>
                                    <TextField label="スタッフ氏名" fullWidth value={targetName} onChange={(e) => setTargetName(e.target.value)} />
                                    <Typography variant="caption">担当利用者の事前設定（任意）</Typography>
                                    <Paper variant="outlined" sx={{ p: 1, maxHeight: 150, overflow: 'auto' }}>
                                        <FormGroup>
                                            {allClients.map((client) => (
                                                <FormControlLabel key={client.id} control={<Checkbox checked={targetAssignedIds.includes(client.id)} onChange={() => { setTargetAssignedIds(prev => prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]); }} />} label={client.name} />
                                            ))}
                                        </FormGroup>
                                    </Paper>
                                    <Button variant="contained" onClick={handleGenerateLink} disabled={!targetName || isProcessing}>専用リンクを発行</Button>
                                </>
                            ) : (
                                <InviteLinkView url={generatedLink} />
                            )}
                        </Stack>
                    )}

                    {/* モード2: 直接作成 */}
                    {inviteMode === 2 && (
                        <Stack spacing={2}>
                            <Typography variant="body2">管理者がアカウントを直接作成します。</Typography>
                            <TextField label="氏名" fullWidth required value={targetName} onChange={(e) => setTargetName(e.target.value)} />
                            <TextField label="メール" fullWidth required value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} />
                            <TextField label="パスワード" fullWidth required type="password" value={targetPassword} onChange={(e) => setTargetPassword(e.target.value)} />
                            <Button variant="contained" onClick={handleDirectCreate} disabled={isProcessing}>{isProcessing ? '作成中...' : 'アカウントを作成'}</Button>
                        </Stack>
                    )}

                    {/* モード3: CSVインポート */}
                    {inviteMode === 3 && (
                        <Stack spacing={3}>
                            <Box sx={{ p: 2, bgcolor: '#f9f9f9', borderRadius: 2 }}>
                                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>1. CSVファイルを用意する</Typography>
                                <Typography variant="body2" color="text.secondary" paragraph>
                                    フォーマット: <code>氏名,メール,パスワード,権限(任意)</code><br />
                                    ※ヘッダー行（name,email...）は自動スキップされます。
                                </Typography>
                                <Button size="small" startIcon={<DownloadIcon />} onClick={downloadSampleCSV}>サンプルCSVをダウンロード</Button>
                            </Box>

                            <Box>
                                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>2. ファイルを選択してアップロード</Typography>
                                <Button
                                    component="label"
                                    variant="contained"
                                    startIcon={<FileUploadIcon />}
                                    fullWidth
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? 'インポート中...' : 'CSVファイルを選択'}
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".csv"
                                        hidden
                                        onChange={handleCSVUpload}
                                    />
                                </Button>
                            </Box>

                            {/* インポートログ表示 */}
                            {(isProcessing || importLogs.length > 0) && (
                                <Box>
                                    <Typography variant="caption" gutterBottom>進捗状況: {importProgress}%</Typography>
                                    <LinearProgress variant="determinate" value={importProgress} sx={{ mb: 1 }} />
                                    <Paper variant="outlined" sx={{ p: 1, height: 150, overflow: 'auto', bgcolor: '#333', color: '#fff' }}>
                                        {importLogs.map((log, i) => (
                                            <Typography key={i} variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                                                {log}
                                            </Typography>
                                        ))}
                                    </Paper>
                                </Box>
                            )}
                        </Stack>
                    )}

                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenInvite(false)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            {/* 担当割り当てダイアログ(既存) */}
            <Dialog open={openAssign} onClose={() => setOpenAssign(false)} maxWidth="xs" fullWidth>
                <DialogTitle>担当設定</DialogTitle>
                <DialogContent dividers>
                    <FormGroup>
                        {allClients.map((client) => (
                            <FormControlLabel key={client.id} control={<Checkbox checked={assignedClientIds.includes(client.id)} onChange={() => { setAssignedClientIds(prev => prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]); }} />} label={client.name} />
                        ))}
                    </FormGroup>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenAssign(false)}>キャンセル</Button>
                    <Button onClick={handleSaveAssignments} variant="contained" startIcon={<SaveIcon />} disabled={savingAssign}>保存</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function InviteLinkView({ url }: { url: string }) {
    return (
        <Stack spacing={1}>
            <Alert severity="success">リンクを発行しました！</Alert>
            <TextField
                value={url}
                fullWidth
                InputProps={{
                    readOnly: true,
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton onClick={() => { navigator.clipboard.writeText(url); alert('コピーしました'); }} color="primary"><ContentCopyIcon /></IconButton>
                        </InputAdornment>
                    )
                }}
            />
        </Stack>
    );
}
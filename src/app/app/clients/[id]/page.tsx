'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Box, Button, Typography, Paper, Stack, TextField,
    MenuItem, IconButton, Card, CardContent, Switch,
    FormControlLabel, Alert, CircularProgress, Divider,
    Tabs, Tab, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
    Tooltip, Chip, Accordion, AccordionSummary, AccordionDetails
} from '@/components/ui/mui';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import SaveIcon from '@mui/icons-material/Save';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TitleIcon from '@mui/icons-material/Title';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderIcon from '@mui/icons-material/Folder';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CopyAllIcon from '@mui/icons-material/CopyAll';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { callGasApi } from '@/app/actions/gas';
import { STANDARD_TEMPLATES, COMPREHENSIVE_TEMPLATE, FormItem } from '@/constants/formTemplates';
import { convertSchemaToReadable, FormItem as HelperFormItem } from '../../../../utils/templateHelper';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, AppDialog, CheckboxGroupField, PageLayout } from '@/components/ui';
import { useFetchData } from '@/hooks/useFetchData';
import {
    getClientAssignmentPermissionHints,
    saveClientAssignments,
    saveClientForm,
    updateClientGoogleLink,
    type AssignmentPermissionHint,
} from '@/app/actions/clients';

type Staff = { id: string; name: string; userId: string | null };

export default function ClientSettingsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const params = useParams();
    const clientId = params.id as string;
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();
    const confirm = useConfirm();

    const [loading, setLoading] = useState(true);
    const [clientName, setClientName] = useState('');
    const [tabIndex, setTabIndex] = useState(0);

    const [formItems, setFormItems] = useState<FormItem[]>([]);
    
    const [allStaffs, setAllStaffs] = useState<Staff[]>([]);
    const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([]);
    const [roundTripDistances, setRoundTripDistances] = useState<Record<string, string>>({});
    const [permissionHints, setPermissionHints] = useState<AssignmentPermissionHint[]>([]);
    
    const [templateId, setTemplateId] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [openCopyDialog, setOpenCopyDialog] = useState(false);
    const [copyTab, setCopyTab] = useState(0); 
    const showSetupWizard = searchParams.get('setup') === '1';

    const fetchClientData = useCallback(async () => {
        try {
            const [
                { data: client },
                { data: template },
                staffsResult,
                { data: assigns },
                permissionHintsResult,
            ] = await Promise.all([
                supabase.from('clients').select('name, google_template_id').eq('id', clientId).single(),
                supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
                currentOrg
                    ? supabase
                        .from('staffs')
                        .select('id, name, user_id')
                        .eq('organization_id', currentOrg.id)
                        .is('archived_at', null)
                        .order('sort_order', { ascending: true, nullsFirst: false })
                        .order('name', { ascending: true })
                    : Promise.resolve(null),
                supabase.from('assignments').select('staff_id, helper_id, round_trip_distance_km').eq('client_id', clientId),
                currentOrg ? getClientAssignmentPermissionHints(currentOrg.id, clientId) : Promise.resolve(null),
            ]);

            if (client) {
                setClientName(client.name);
                setTemplateId(client.google_template_id || '');
            }

            if (template?.schema && Array.isArray(template.schema) && template.schema.length > 0) {
                setFormItems(template.schema as FormItem[]);
            } else {
                const initItems = COMPREHENSIVE_TEMPLATE.map(item => ({ ...item, id: crypto.randomUUID() }));
                setFormItems(initItems);
            }

            if (currentOrg) {
                if (staffsResult?.error) throw staffsResult.error;
                const staffRows = staffsResult?.data;
                const staffs: Staff[] = (staffRows || []).map((staff) => ({
                    id: staff.id,
                    name: staff.name,
                    userId: staff.user_id,
                }));
                setAllStaffs(staffs);

                if (assigns) {
                    const staffIdByUserId = new Map(staffs.filter((staff) => staff.userId).map((staff) => [staff.userId, staff.id]));
                    const ids = assigns
                        .map((assignment) => assignment.staff_id || staffIdByUserId.get(assignment.helper_id))
                        .filter((id): id is string => Boolean(id));
                    setAssignedStaffIds(ids);
                    const distances: Record<string, string> = {};
                    assigns.forEach((assignment) => {
                        const staffId = assignment.staff_id || staffIdByUserId.get(assignment.helper_id);
                        if (staffId) distances[staffId] = String(assignment.round_trip_distance_km ?? 0);
                    });
                    setRoundTripDistances(distances);
                }
                if (permissionHintsResult) setPermissionHints(permissionHintsResult);
            }

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [clientId, currentOrg]);

    const fetchOtherClients = useCallback(async () => {
        if (!currentOrg) return [];
        const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).neq('id', clientId);
        return data || [];
    }, [currentOrg, clientId]);

    const { data: otherClients } = useFetchData(fetchOtherClients, [] as {id: string, name: string}[], !wsLoading && Boolean(currentOrg), () => {
        showToast('コピー元利用者の取得に失敗しました', 'error');
    });

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            const id = window.setTimeout(() => void fetchClientData(), 0);
            return () => window.clearTimeout(id);
        }
        return undefined;
    }, [wsLoading, currentOrg, fetchClientData]);

    const addField = () => {
        const newField: FormItem = { id: crypto.randomUUID(), label: '', type: 'checkbox', required: false, hasDetail: false };
        setFormItems([...formItems, newField]);
    };
    const removeField = async (index: number) => {
        if (!(await confirm({ message: 'この項目を削除しますか？', confirmText: '削除する', confirmColor: 'error' }))) return;
        const newItems = [...formItems];
        newItems.splice(index, 1);
        setFormItems(newItems);
    };
    const updateField = (index: number, key: keyof FormItem, value: FormItem[keyof FormItem]) => {
        const newItems = [...formItems];
        newItems[index] = { ...newItems[index], [key]: value };
        setFormItems(newItems);
    };
    const moveField = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === formItems.length - 1) return;
        const newItems = [...formItems];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
        setFormItems(newItems);
    };

    const handleSaveForm = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            if (!currentOrg) throw new Error('事業所が選択されていません');
            await saveClientForm(currentOrg.id, clientId, formItems);
            setMessage({ type: 'success', text: 'フォーム設定を保存しました！' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: '保存に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAssignments = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            if (!currentOrg) throw new Error('事業所が選択されていません');
            const distancePayload = Object.fromEntries(
                assignedStaffIds.map((staffId) => [staffId, Number(roundTripDistances[staffId] || 0)])
            );
            await saveClientAssignments(currentOrg.id, clientId, assignedStaffIds, distancePayload);

            setMessage({ type: 'success', text: '担当スタッフを更新しました！' });
            setTimeout(() => setMessage(null), 3000);
            fetchClientData();
        } catch (error) {
            console.error('Assignment save error:', error);
            setMessage({ type: 'error', text: '更新に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveTemplateId = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            if (!currentOrg) throw new Error('事業所が選択されていません');
            await updateClientGoogleLink(currentOrg.id, clientId, { templateId });
            setMessage({ type: 'success', text: 'テンプレートIDを保存しました' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '保存失敗' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopy = async (sourceType: 'standard' | 'client', sourceId: string) => {
        if (!(await confirm({ message: '現在の設定はすべて上書きされます。よろしいですか？' }))) return;

        let newSchema: FormItem[] = [];
        if (sourceType === 'standard') {
            const tmpl = STANDARD_TEMPLATES.find(t => t.key === sourceId);
            if (tmpl) newSchema = tmpl.schema;
        } else {
            const { data: template } = await supabase.from('form_templates').select('schema').eq('client_id', sourceId).maybeSingle();
            if (template?.schema) {
                newSchema = template.schema as FormItem[];
            }
        }

        if (newSchema.length > 0) {
            const copiedItems = newSchema.map(item => ({ ...item, id: crypto.randomUUID() }));
            setFormItems(copiedItems);
            setOpenCopyDialog(false);
            setMessage({ type: 'success', text: '設定を反映しました' });
        } else {
            showToast('テンプレートの取得に失敗しました', 'error');
        }
    };

    const handleCreateTemplate = async () => {
        if (!currentOrg || !clientName) return;

        if (templateId) {
            if (!(await confirm({ message: '既にテンプレートIDが入力されています。新しく作成して上書きしますか？' }))) return;
        }

        setIsCreatingTemplate(true);
        setMessage(null);

        try {
            const { data: orgData } = await supabase.from('organizations').select('google_folder_id').eq('id', currentOrg.id).single();
            const { data: clientData } = await supabase.from('clients').select('google_folder_id').eq('id', clientId).single();
            
            if (!orgData?.google_folder_id) {
                throw new Error('事業所のGoogleドライブ連携が設定されていません。「事業所設定」から連携を行ってください。');
            }

            const folderRes = await callGasApi({
                action: 'manage_client_folder',
                organizationId: currentOrg.id,
                clientId,
                orgFolderId: orgData.google_folder_id,
                clientName: clientName,
                currentFolderId: clientData?.google_folder_id
            });
            
            if (folderRes.status !== 'success') throw new Error('フォルダ作成エラー: ' + folderRes.message);
            
            if (folderRes.folderId !== clientData?.google_folder_id) {
                await updateClientGoogleLink(currentOrg.id, clientId, { folderId: folderRes.folderId });
            }

            const readableSchema = convertSchemaToReadable(formItems);

            const createRes = await callGasApi({
                action: 'create_template_doc',
                organizationId: currentOrg.id,
                clientId,
                folderId: folderRes.folderId,
                clientName: clientName,
                schema: readableSchema 
            });

            if (createRes.status === 'success') {
                setTemplateId(createRes.docId);
                await updateClientGoogleLink(currentOrg.id, clientId, { templateId: createRes.docId });
                setMessage({ type: 'success', text: 'テンプレートを作成し、連携しました！別タブで開きます。' });
                window.open(createRes.docUrl, '_blank');
            } else {
                throw new Error(createRes.message);
            }

        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: 'エラーが発生しました: ' + String(e) });
        } finally {
            setIsCreatingTemplate(false);
        }
    };

    const copyTag = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast(`コピーしました: ${text}`);
    };

    // UI用: スキーマを日本語化してリスト表示用に加工
    const renderTagList = () => {
        const readableItems = convertSchemaToReadable(formItems);
        const groups: { title: string, items: HelperFormItem[] }[] = [];
        let currentGroup = { title: '基本・その他', items: [] as HelperFormItem[] };

        readableItems.forEach(item => {
            if (item.type === 'section') {
                if (currentGroup.items.length > 0) groups.push(currentGroup);
                currentGroup = { title: item.label, items: [] };
            } else {
                currentGroup.items.push(item);
            }
        });
        if (currentGroup.items.length > 0) groups.push(currentGroup);

        return groups;
    };

    // 全タグを一括コピーする機能
    const handleCopyAllTags = () => {
        const groups = renderTagList();
        let allTagsText = "";
        
        groups.forEach(group => {
            allTagsText += `\n■ ${group.title}\n`;
            group.items.forEach((item: HelperFormItem) => {
                if (['checkbox', 'text', 'number', 'time'].includes(item.type)) {
                    allTagsText += `${item.label}: {{${item.id}}}\n`;
                    if (item.hasDetail) allTagsText += `  └ 詳細: {{${item.id}_詳細}}\n`;
                } else if (['multicheckbox', 'select'].includes(item.type)) {
                    allTagsText += `▼ ${item.label}\n`;
                    const options = item.options?.split(',') || [];
                    options.forEach((opt: string) => {
                        // ★修正ポイント: フォーマットを「項目名: {{タグ}}」に変更
                        allTagsText += `${opt.trim()}: {{${item.id}_${opt.trim()}}}  `;
                    });
                    allTagsText += "\n";
                    if (item.hasDetail) allTagsText += `  (詳細/他: {{${item.id}_詳細}})\n`;
                }
            });
        });
        
        allTagsText += "\n■ 共通項目\n";
        ['利用者名', '担当ヘルパー名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間', '移動時間'].forEach(key => {
            allTagsText += `${key}: {{${key}}}\n`;
        });

        navigator.clipboard.writeText(allTagsText);
        showToast("全てのタグをコピーしました");
    };

    if (loading) return <Box p={4}><CircularProgress /></Box>;

    return (
        <PageLayout>
            <Box sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                    <IconButton onClick={() => router.back()}><ArrowBackIcon /></IconButton>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary">利用者設定</Typography>
                        <Typography variant="h5" fontWeight="bold" sx={{ overflowWrap: 'anywhere' }}>{clientName} 様</Typography>
                    </Box>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="scrollable" allowScrollButtonsMobile>
                    <Tab icon={<DescriptionIcon />} label="記録フォーム" />
                    <Tab icon={<AssignmentIndIcon />} label="担当スタッフ" />
                    <Tab icon={<FolderIcon />} label="帳票・連携" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 2, sm: 3 }, bgcolor: 'background.default' }}>
                {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}
                {showSetupWizard && (
                    <Alert
                        severity="info"
                        sx={{ mb: 3 }}
                        action={<Button color="inherit" size="small" onClick={() => router.replace(`/app/clients/${clientId}`)}>完了</Button>}
                    >
                        利用者を追加しました。記録フォーム、担当スタッフ、帳票・連携の順に設定してください。
                    </Alert>
                )}

                {tabIndex === 0 && (
                    <Box>
                        <Box display="flex" justifyContent="flex-end" gap={1} mb={2} sx={{ flexWrap: 'wrap', '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
                            <Button 
                                variant="outlined" 
                                startIcon={<ContentCopyIcon />} 
                                onClick={() => { setOpenCopyDialog(true); setCopyTab(0); }}
                            >
                                テンプレート読込 / コピー
                            </Button>
                        </Box>
                        <Stack spacing={2} pb={2}>
                            {formItems.map((item, index) => (
                                <Card key={item.id} sx={{ overflow: 'visible', borderLeft: item.type === 'section' ? '6px solid' : 'none', borderLeftColor: 'primary.main', bgcolor: item.type === 'section' ? 'background.tint' : 'background.paper' }}>
                                    <CardContent sx={{ p: '16px !important' }}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start" spacing={2}>
                                            <Stack
                                                direction={{ xs: 'row', md: 'column' }}
                                                spacing={0.5}
                                                sx={{
                                                    width: { xs: '100%', md: 'auto' },
                                                    justifyContent: { xs: 'space-between', md: 'flex-start' },
                                                }}
                                            >
                                                <IconButton size="small" onClick={() => moveField(index, 'up')} disabled={index === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                                                <IconButton size="small" onClick={() => moveField(index, 'down')} disabled={index === formItems.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                                                <IconButton color="error" size="small" onClick={() => removeField(index)} sx={{ mt: { md: 1 } }}><DeleteIcon fontSize="small" /></IconButton>
                                            </Stack>
                                            <Box sx={{ flexGrow: 1, width: '100%' }}>
                                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={1}>
                                                    <TextField select label="種類" size="small" value={item.type} onChange={(e) => updateField(index, 'type', e.target.value as FormItem['type'])} sx={{ width: { xs: '100%', md: 'auto' }, minWidth: { md: 160 } }} slotProps={{ input: { startAdornment: item.type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null } }}>
                                                        <MenuItem value="section" sx={{ fontWeight: 'bold', color: 'primary.main' }}>■ セクション見出し</MenuItem>
                                                        <Divider /><MenuItem value="checkbox">チェック (ON/OFF)</MenuItem><MenuItem value="multicheckbox">複数選択</MenuItem><MenuItem value="text">テキスト入力</MenuItem><MenuItem value="number">数値入力</MenuItem><MenuItem value="select">1つ選択 (ラジオ)</MenuItem><MenuItem value="time">時間</MenuItem>
                                                    </TextField>
                                                    <TextField label={item.type === 'section' ? "セクション名" : "質問内容"} size="small" fullWidth value={item.label} onChange={(e) => updateField(index, 'label', e.target.value)} sx={{ '& .MuiInputBase-input': { fontWeight: item.type === 'section' ? 'bold' : 'normal', fontSize: item.type === 'section' ? '1.1rem' : '1rem' } }} />
                                                    {item.type !== 'section' && <FormControlLabel control={<Switch size="small" checked={item.required} onChange={(e) => updateField(index, 'required', e.target.checked)} />} label="必須" sx={{ minWidth: 80, alignSelf: { xs: 'flex-start', md: 'center' } }} />}
                                                </Stack>
                                                {(item.type === 'checkbox' || item.type === 'multicheckbox' || item.type === 'select') && (
                                                    <FormControlLabel control={<Switch size="small" color="secondary" checked={!!item.hasDetail} onChange={(e) => updateField(index, 'hasDetail', e.target.checked)} />} label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} sx={{ mb: 1, ml: { xs: 0, sm: 1 } }} />
                                                )}
                                                {(item.type === 'select' || item.type === 'multicheckbox') && (
                                                    <TextField label="選択肢（カンマ区切り）" size="small" fullWidth value={item.options || ''} onChange={(e) => updateField(index, 'options', e.target.value)} slotProps={{ input: { startAdornment: <CheckBoxIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} /> } }} />
                                                )}
                                            </Box>
                                        </Stack>
                                    </CardContent>
                                </Card>
                            ))}
                            <Button variant="outlined" startIcon={<AddCircleIcon />} onClick={addField} size="large" sx={{ border: '2px dashed', borderColor: 'divider', color: 'text.secondary', py: 2 }}>項目を追加する</Button>
                        </Stack>
                    </Box>
                )}

                {tabIndex === 1 && (
                    <Card variant="outlined">
                        <CardContent>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>この利用者を担当するスタッフを選択してください</Typography>
                            <Typography variant="body2" color="text.secondary" mb={3}>選択したスタッフのみが、記録入力画面の「担当ヘルパー」選択肢に表示されます。往復距離は記録作成時の初期値になります。</Typography>
                            {permissionHints.some((hint) => hint.canCreateAllRecords) && (
                                <Alert severity="info" sx={{ mb: 2 }}>
                                    全体の記録作成権限を持つスタッフは、ここで担当に入っていなくても記録を作成できます。
                                </Alert>
                            )}
                            <Stack spacing={3}>
                                <CheckboxGroupField
                                    label="メンバー（ログインユーザー）"
                                    options={allStaffs.filter((staff) => staff.userId !== null)}
                                    value={assignedStaffIds}
                                    onChange={setAssignedStaffIds}
                                    getOptionLabel={(staff) => staff.name}
                                    getOptionValue={(staff) => staff.id}
                                />
                                <CheckboxGroupField
                                    label="アカウントなし（転記用）"
                                    options={allStaffs.filter((staff) => staff.userId === null)}
                                    value={assignedStaffIds}
                                    onChange={setAssignedStaffIds}
                                    getOptionLabel={(staff) => staff.name}
                                    getOptionValue={(staff) => staff.id}
                                />
                                {assignedStaffIds.length > 0 && (
                                    <Box sx={{ p: 2, bgcolor: 'background.muted', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
                                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>スタッフ別 往復移動距離</Typography>
                                        <Stack spacing={1.5}>
                                            {allStaffs.filter((staff) => assignedStaffIds.includes(staff.id)).map((staff) => (
                                                <Stack key={staff.id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                                    <Box sx={{ minWidth: { sm: 180 } }}>
                                                        <Typography sx={{ fontWeight: 'bold', overflowWrap: 'anywhere' }}>{staff.name}</Typography>
                                                        {permissionHints.find((hint) => hint.staffId === staff.id)?.canCreateAllRecords && (
                                                            <Chip
                                                                label="全体権限で記録作成可"
                                                                size="small"
                                                                color="success"
                                                                variant="outlined"
                                                                sx={{ mt: 0.5 }}
                                                            />
                                                        )}
                                                    </Box>
                                                    <TextField
                                                        label="往復距離"
                                                        type="number"
                                                        size="small"
                                                        value={roundTripDistances[staff.id] ?? '0'}
                                                        onChange={(e) => setRoundTripDistances(prev => ({ ...prev, [staff.id]: e.target.value }))}
                                                        onWheel={e => (e.target as HTMLElement).blur()}
                                                        sx={{ maxWidth: { sm: 220 } }}
                                                        slotProps={{ input: { endAdornment: <Typography variant="caption" color="text.secondary">km</Typography> }, htmlInput: { inputMode: 'decimal', step: '0.1', min: 0 } }}
                                                    />
                                                </Stack>
                                            ))}
                                        </Stack>
                                    </Box>
                                )}
                            </Stack>
                        </CardContent>
                    </Card>
                )}

                {tabIndex === 2 && (
                    <Stack spacing={3}>
                        <Card variant="outlined">
                            <CardContent>
                                <Stack direction="row" alignItems="center" gap={2} mb={2}>
                                    <DescriptionIcon color="primary" fontSize="large" />
                                    <Box>
                                        <Typography variant="h6" fontWeight="bold">Googleドキュメント連携</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            帳票の雛形（テンプレート）を管理します。
                                        </Typography>
                                    </Box>
                                </Stack>

                                <Divider sx={{ my: 2 }} />

                                <Box mb={4}>
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
                                        <AutoFixHighIcon color="secondary" fontSize="small" /> 1. テンプレートを作成・連携
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" paragraph>
                                        マスターテンプレート（共通のひな形）をコピーして、この利用者専用のGoogleドキュメントを作成します。<br/>
                                        作成後、下記リストから必要なタグをコピーしてドキュメントに貼り付け、レイアウトを調整してください。
                                    </Typography>
                                    
                                    <Button 
                                        variant="contained" 
                                        color="secondary" 
                                        onClick={handleCreateTemplate} 
                                        disabled={isCreatingTemplate || formItems.length === 0}
                                        startIcon={isCreatingTemplate ? <CircularProgress size={20} color="inherit" /> : <AddCircleIcon />}
                                    >
                                        {isCreatingTemplate ? '作成中...' : 'テンプレートを新規作成する'}
                                    </Button>
                                    
                                    <Box mt={2}>
                                        <Typography variant="caption" color="text.secondary">ID手動設定:</Typography>
                                        <TextField 
                                            size="small"
                                            fullWidth
                                            value={templateId} 
                                            onChange={(e) => setTemplateId(e.target.value)} 
                                            placeholder="作成済みのGoogleドキュメントIDがあればここに入力" 
                                            sx={{ mt: 0.5 }}
                                        />
                                    </Box>
                                </Box>

                                <Divider />

                                <Box mt={3}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                                        <Typography variant="subtitle2" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                            <ContentPasteIcon color="primary" fontSize="small" /> 2. 利用可能な差し込みタグ一覧
                                        </Typography>
                                        <Button 
                                            variant="outlined" 
                                            size="small" 
                                            startIcon={<CopyAllIcon />} 
                                            onClick={handleCopyAllTags}
                                        >
                                            全てのタグをコピー
                                        </Button>
                                    </Stack>
                                    <Alert severity="info" sx={{ mb: 2 }}>
                                        クリックするとタグをコピーできます。Googleドキュメントの表の中に貼り付けてください。<br/>
                                        データが存在する場合、タグの部分が ☑︎ やテキストに置き換わります。
                                    </Alert>

                                    {renderTagList().map((group, gIdx) => (
                                        <Accordion key={gIdx} defaultExpanded={gIdx === 0}>
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'background.muted' }}>
                                                <Typography fontWeight="bold">{group.title}</Typography>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Box display="flex" flexWrap="wrap" gap={1}>
                                                    {group.items.map(item => {
                                                        if (['checkbox', 'text', 'number', 'time'].includes(item.type)) {
                                                            const tag = `{{${item.id}}}`;
                                                            const detailTag = item.hasDetail ? `{{${item.id}_詳細}}` : null;
                                                            return (
                                                                <Box key={item.id} display="flex" gap={1} alignItems="center">
                                                                    <Tooltip title="クリックしてコピー">
                                                                        <Chip label={`${item.label}: ${tag}`} onClick={() => copyTag(tag)} clickable />
                                                                    </Tooltip>
                                                                    {detailTag && (
                                                                        <Tooltip title="詳細入力のタグ">
                                                                            <Chip label={`詳細: ${detailTag}`} onClick={() => copyTag(detailTag)} clickable size="small" variant="outlined" />
                                                                        </Tooltip>
                                                                    )}
                                                                </Box>
                                                            );
                                                        }
                                                        if (['multicheckbox', 'select'].includes(item.type)) {
                                                            const options = item.options?.split(',') || [];
                                                            return (
                                                                <Box key={item.id} width="100%" sx={{ p: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                                                                    <Typography variant="caption" display="block" mb={0.5} fontWeight="bold">{item.label}</Typography>
                                                                    <Box display="flex" flexWrap="wrap" gap={1}>
                                                                        {options.map((opt: string) => {
                                                                            const cleanOpt = opt.trim();
                                                                            const tag = `{{${item.id}_${cleanOpt}}}`;
                                                                            return (
                                                                                <Tooltip key={cleanOpt} title="クリックしてコピー">
                                                                                    {/* ★修正ポイント: ラベルの形式を変更 */}
                                                                                    <Chip label={`${cleanOpt}: ${tag}`} onClick={() => copyTag(tag)} clickable size="small" />
                                                                                </Tooltip>
                                                                            );
                                                                        })}
                                                                        {item.hasDetail && (
                                                                            <Tooltip title="詳細/その他のタグ">
                                                                                <Chip label={`詳細: {{${item.id}_詳細}}`} onClick={() => copyTag(`{{${item.id}_詳細}}`)} clickable size="small" variant="outlined" />
                                                                            </Tooltip>
                                                                        )}
                                                                    </Box>
                                                                </Box>
                                                            );
                                                        }
                                                        return null;
                                                    })}
                                                </Box>
                                            </AccordionDetails>
                                        </Accordion>
                                    ))}
                                    
                                    <Accordion>
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'background.muted' }}>
                                            <Typography fontWeight="bold">共通項目（日付・ヘルパー名など）</Typography>
                                        </AccordionSummary>
                                        <AccordionDetails>
                                            <Box display="flex" flexWrap="wrap" gap={1}>
                                                {['利用者名', '担当ヘルパー名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間', '移動時間'].map(key => (
                                                    <Tooltip key={key} title="クリックしてコピー">
                                                        <Chip label={`{{${key}}}`} onClick={() => copyTag(`{{${key}}}`)} clickable color="primary" variant="outlined" />
                                                    </Tooltip>
                                                ))}
                                            </Box>
                                        </AccordionDetails>
                                    </Accordion>
                                </Box>
                            </CardContent>
                        </Card>
                    </Stack>
                )}
            </Box>

            <Paper elevation={3} sx={{ p: { xs: 1.5, sm: 2 }, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'center', bgcolor: 'background.paper', flexShrink: 0, zIndex: 10 }}>
                <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={() => { if (tabIndex === 0) handleSaveForm(); if (tabIndex === 1) handleSaveAssignments(); if (tabIndex === 2) handleSaveTemplateId(); }} disabled={isSaving} sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: { sm: 300 }, fontWeight: 'bold', height: 48 }}>
                    {isSaving ? '保存中...' : '設定を保存'}
                </Button>
            </Paper>

            <AppDialog open={openCopyDialog} onClose={() => setOpenCopyDialog(false)} maxWidth="sm" title="記録項目の設定を読み込む" contentSx={{ p: 0 }} actions={<AppButton variant="text" intent="secondary" onClick={() => setOpenCopyDialog(false)}>キャンセル</AppButton>}>
                    <Tabs 
                        value={copyTab} 
                        onChange={(_, v) => setCopyTab(v)} 
                        variant="fullWidth" 
                        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.muted' }}
                    >
                        <Tab icon={<LibraryBooksIcon />} label="標準テンプレート" />
                        <Tab icon={<PersonIcon />} label="他の利用者からコピー" />
                    </Tabs>

                    <Box sx={{ p: 2, minHeight: 300 }}>
                        {copyTab === 0 && (
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">
                                    用途に合わせて標準的な記録項目セットを一括反映します。<br/>
                                    反映後、自由に項目の追加・削除が可能です。
                                </Typography>
                                <List sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                                    {STANDARD_TEMPLATES.map((tmpl, index) => (
                                        <div key={tmpl.key}>
                                            <ListItem disablePadding>
                                                <ListItemButton onClick={() => handleCopy('standard', tmpl.key)}>
                                                    <ListItemIcon>
                                                        <ContentPasteIcon color="primary" />
                                                    </ListItemIcon>
                                                    <ListItemText 
                                                        primary={<Typography fontWeight="bold">{tmpl.name}</Typography>} 
                                                        secondary={tmpl.description} 
                                                    />
                                                </ListItemButton>
                                            </ListItem>
                                            {index < STANDARD_TEMPLATES.length - 1 && <Divider />}
                                        </div>
                                    ))}
                                </List>
                            </Stack>
                        )}

                        {copyTab === 1 && (
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">
                                    同じ事業所内の他の利用者の設定をコピーします。
                                </Typography>
                                {otherClients.length === 0 ? (
                                    <Alert severity="info">他に登録されている利用者がいません</Alert>
                                ) : (
                                    <List sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                                        {otherClients.map((client, index) => (
                                            <div key={client.id}>
                                                <ListItem disablePadding>
                                                    <ListItemButton onClick={() => handleCopy('client', client.id)}>
                                                        <ListItemIcon>
                                                            <PersonIcon color="secondary" />
                                                        </ListItemIcon>
                                                        <ListItemText primary={client.name} />
                                                    </ListItemButton>
                                                </ListItem>
                                                {index < otherClients.length - 1 && <Divider />}
                                            </div>
                                        ))}
                                    </List>
                                )}
                            </Stack>
                        )}
                    </Box>
            </AppDialog>
        </PageLayout>
    );
}

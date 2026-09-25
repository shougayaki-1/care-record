'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Box, Button, Typography, Paper, Stack,
    IconButton, Alert, CircularProgress, Divider,
    Tabs, Tab, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
} from '@/components/ui/mui';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderIcon from '@mui/icons-material/Folder';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { callGasApi } from '@/app/actions/gas';
import { STANDARD_TEMPLATES, COMPREHENSIVE_TEMPLATE, FormItem } from '@/constants/formTemplates';
import { convertSchemaToReadable, FormItem as HelperFormItem } from '../../../../utils/templateHelper';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { AppButton, AppDialog, PageLayout } from '@/components/ui';
import { useFetchData } from '@/hooks/useFetchData';
import {
    getClientAssignmentPermissionHints,
    saveClientAssignments,
    saveClientForm,
    updateClientGoogleLink,
    type AssignmentPermissionHint,
} from '@/app/actions/clients';
import { FormBuilderTab } from '@/components/clients/FormBuilderTab';
import { IntegrationsTab } from '@/components/clients/IntegrationsTab';
import { StaffAssignmentTab } from '@/components/clients/StaffAssignmentTab';

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
    const [defaultTravelCosts, setDefaultTravelCosts] = useState<Record<string, string>>({});
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
            // Core client data. All four are supabase queries that resolve to
            // { data, error } and never reject, so Promise.all is safe here.
            const [
                { data: client },
                { data: template },
                staffsResult,
                { data: assigns },
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
                supabase.from('assignments').select('staff_id, helper_id, default_travel_cost_yen').eq('client_id', clientId),
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
                    const costs: Record<string, string> = {};
                    assigns.forEach((assignment) => {
                        const staffId = assignment.staff_id || staffIdByUserId.get(assignment.helper_id);
                        if (staffId) costs[staffId] = assignment.default_travel_cost_yen == null ? '' : String(assignment.default_travel_cost_yen);
                    });
                    setDefaultTravelCosts(costs);
                }
            }

        } catch (error) {
            console.error(error);
            showToast('利用者情報の取得に失敗しました', 'error');
        } finally {
            setLoading(false);
        }

        // Permission hints are advisory UI. getClientAssignmentPermissionHints is
        // a withSafeError Server Action that CAN throw (unlike the supabase queries
        // above), so it is fetched separately: a hints failure must not discard the
        // core client data. Mirrors d7aff24 for record/[clientId].
        if (currentOrg) {
            try {
                const hints = await getClientAssignmentPermissionHints(currentOrg.id, clientId);
                if (hints) setPermissionHints(hints);
            } catch (error) {
                console.error('permission hints load failed:', error);
            }
        }
    }, [clientId, currentOrg, showToast]);

    const fetchOtherClients = useCallback(async () => {
        if (!currentOrg) return [];
        const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).neq('id', clientId);
        return data || [];
    }, [currentOrg, clientId]);

    const { data: otherClients } = useFetchData(fetchOtherClients, [] as {id: string, name: string}[], !wsLoading && Boolean(currentOrg), () => {
        showToast('コピー元利用者の取得に失敗しました', 'error');
    }, `${currentOrg?.id ?? ''}:${clientId}`);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            const id = window.setTimeout(() => void fetchClientData(), 0);
            return () => window.clearTimeout(id);
        }
        return undefined;
    }, [wsLoading, currentOrg, fetchClientData]);

    const addField = (index: number) => {
        const newField: FormItem = { id: crypto.randomUUID(), label: '', type: 'checkbox', required: false, hasDetail: false };
        setFormItems((items) => [...items.slice(0, index), newField, ...items.slice(index)]);
        return newField.id;
    };
    const removeField = async (index: number) => {
        if (!(await confirm({ message: 'この項目を削除しますか？', confirmText: '削除する', confirmColor: 'error' }))) return;
        const newItems = [...formItems];
        newItems.splice(index, 1);
        setFormItems(newItems);
    };
    const updateField = (index: number, key: keyof FormItem, value: FormItem[keyof FormItem]) => {
        setFormItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
    };
    const moveField = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === formItems.length - 1) return;
        const newItems = [...formItems];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
        setFormItems(newItems);
    };
    const moveFieldTo = (index: number, targetIndex: number) => {
        if (index === targetIndex || targetIndex < 0 || targetIndex >= formItems.length) return;
        const newItems = [...formItems];
        const [item] = newItems.splice(index, 1);
        newItems.splice(targetIndex, 0, item);
        setFormItems(newItems);
    };

    // 選択肢はカンマ区切り文字列として保存する既存フォーマットを維持しつつ、行編集UIで扱えるようにする
    const getOptionsArray = (options?: string): string[] => (options ? options.split(',') : []);
    const updateOption = (index: number, optIndex: number, value: string) => {
        const opts = getOptionsArray(formItems[index].options);
        opts[optIndex] = value;
        updateField(index, 'options', opts.join(','));
    };
    const addOption = (index: number) => {
        const opts = getOptionsArray(formItems[index].options);
        opts.push('');
        updateField(index, 'options', opts.join(','));
    };
    const removeOption = (index: number, optIndex: number) => {
        const opts = getOptionsArray(formItems[index].options);
        opts.splice(optIndex, 1);
        updateField(index, 'options', opts.join(','));
    };
    const moveOption = (index: number, optIndex: number, direction: 'up' | 'down') => {
        const opts = getOptionsArray(formItems[index].options);
        const targetIndex = direction === 'up' ? optIndex - 1 : optIndex + 1;
        if (targetIndex < 0 || targetIndex >= opts.length) return;
        [opts[optIndex], opts[targetIndex]] = [opts[targetIndex], opts[optIndex]];
        updateField(index, 'options', opts.join(','));
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
            const costPayload = Object.fromEntries(
                assignedStaffIds.filter((staffId) => defaultTravelCosts[staffId] !== undefined && defaultTravelCosts[staffId] !== '').map((staffId) => [staffId, Number(defaultTravelCosts[staffId])])
            );
            await saveClientAssignments(currentOrg.id, clientId, assignedStaffIds, costPayload);

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
                    <FormBuilderTab
                        formItems={formItems}
                        onOpenCopy={() => { setOpenCopyDialog(true); setCopyTab(0); }}
                        onAddField={addField}
                        onRemoveField={removeField}
                        onUpdateField={updateField}
                        onMoveField={moveField}
                        onMoveFieldTo={moveFieldTo}
                        getOptions={getOptionsArray}
                        onUpdateOption={updateOption}
                        onAddOption={addOption}
                        onRemoveOption={removeOption}
                        onMoveOption={moveOption}
                    />
                )}
                {tabIndex === 1 && (
                    <StaffAssignmentTab
                        allStaffs={allStaffs}
                        assignedStaffIds={assignedStaffIds}
                        setAssignedStaffIds={setAssignedStaffIds}
                        defaultTravelCosts={defaultTravelCosts}
                        setDefaultTravelCosts={setDefaultTravelCosts}
                        permissionHints={permissionHints}
                    />
                )}
                {tabIndex === 2 && (
                    <IntegrationsTab
                        templateId={templateId}
                        setTemplateId={setTemplateId}
                        isCreatingTemplate={isCreatingTemplate}
                        hasFormItems={formItems.length > 0}
                        onCreateTemplate={handleCreateTemplate}
                        onCopyAllTags={handleCopyAllTags}
                        onCopyTag={copyTag}
                        tagGroups={renderTagList()}
                    />
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

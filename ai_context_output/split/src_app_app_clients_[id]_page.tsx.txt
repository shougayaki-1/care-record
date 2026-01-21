'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Box, Button, Typography, Paper, Stack, TextField,
    MenuItem, IconButton, Card, CardContent, Switch,
    FormControlLabel, Alert, CircularProgress, Dialog,
    DialogTitle, DialogContent, DialogActions, Divider,
    Tabs, Tab, Checkbox, FormGroup, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
    Tooltip, Chip, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
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

import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';
import { callGasApi } from '@/app/actions/gas';
import { STANDARD_TEMPLATES, COMPREHENSIVE_TEMPLATE, FormItem } from '@/constants/formTemplates';
import { convertSchemaToReadable, FormItem as HelperFormItem } from '../../../../utils/templateHelper';
import { useToast } from '@/components/ui/ToastProvider';

type Staff = { id: string; name: string; type: 'member' | 'ghost' };

export default function ClientSettingsPage() {
    const router = useRouter();
    const params = useParams();
    const clientId = params.id as string;
    const { currentOrg, loading: wsLoading } = useWorkspace();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [clientName, setClientName] = useState('');
    const [tabIndex, setTabIndex] = useState(0);

    const [formItems, setFormItems] = useState<FormItem[]>([]);
    
    const [allStaffs, setAllStaffs] = useState<Staff[]>([]);
    const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([]);
    
    const [templateId, setTemplateId] = useState('');

    const [isSaving, setIsSaving] = useState(false);
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [openCopyDialog, setOpenCopyDialog] = useState(false);
    const [copyTab, setCopyTab] = useState(0); 
    const [otherClients, setOtherClients] = useState<{id: string, name: string}[]>([]);

    const fetchClientData = useCallback(async () => {
        try {
            const { data: client } = await supabase.from('clients').select('name, google_template_id').eq('id', clientId).single();
            if (client) {
                setClientName(client.name);
                setTemplateId(client.google_template_id || '');
            }

            const { data: template } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
            if (template?.schema && Array.isArray(template.schema) && template.schema.length > 0) {
                setFormItems(template.schema as FormItem[]);
            } else {
                const initItems = COMPREHENSIVE_TEMPLATE.map(item => ({ ...item, id: crypto.randomUUID() }));
                setFormItems(initItems);
            }

            if (currentOrg) {
                let staffs: Staff[] = [];
                const { data: members } = await supabase.from('organization_members').select('user_id').eq('organization_id', currentOrg.id);
                if (members) {
                    const userIds = members.map(m => m.user_id);
                    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds);
                    if (profiles) staffs = [...staffs, ...profiles.map(p => ({ id: p.id, name: p.name, type: 'member' as const }))];
                }
                const { data: ghosts } = await supabase.from('ghost_staffs').select('id, name').eq('organization_id', currentOrg.id);
                if (ghosts) staffs = [...staffs, ...ghosts.map(g => ({ id: g.id, name: g.name, type: 'ghost' as const }))];
                
                setAllStaffs(staffs);

                const { data: assigns } = await supabase.from('assignments').select('helper_id, ghost_staff_id').eq('client_id', clientId);
                if (assigns) {
                    const ids = assigns.map(a => a.helper_id || a.ghost_staff_id).filter(id => id !== null) as string[];
                    setAssignedStaffIds(ids);
                }
            }

        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [clientId, currentOrg]);

    const fetchOtherClients = useCallback(async () => {
        if (!currentOrg) return;
        const { data } = await supabase.from('clients').select('id, name').eq('organization_id', currentOrg.id).neq('id', clientId);
        setOtherClients(data || []);
    }, [currentOrg, clientId]);

    useEffect(() => {
        if (!wsLoading && currentOrg) {
            fetchClientData();
            fetchOtherClients();
        }
    }, [wsLoading, currentOrg, fetchClientData, fetchOtherClients]);

    const addField = () => {
        const newField: FormItem = { id: crypto.randomUUID(), label: '', type: 'checkbox', required: false, hasDetail: false };
        setFormItems([...formItems, newField]);
    };
    const removeField = (index: number) => {
        if (!confirm('この項目を削除しますか？')) return;
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
            const { data: existing } = await supabase.from('form_templates').select('id').eq('client_id', clientId).maybeSingle();
            if (existing) {
                const { error } = await supabase.from('form_templates').update({ schema: formItems, updated_at: new Date() }).eq('client_id', clientId);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('form_templates').insert({ client_id: clientId, schema: formItems });
                if (error) throw error;
            }
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
            const { error: deleteError } = await supabase.from('assignments').delete().eq('client_id', clientId);
            if (deleteError) throw deleteError;

            const inserts = assignedStaffIds.map(staffId => {
                const staff = allStaffs.find(s => s.id === staffId);
                return {
                    client_id: clientId,
                    helper_id: staff?.type === 'member' ? staffId : null,
                    ghost_staff_id: staff?.type === 'ghost' ? staffId : null
                };
            });

            if (inserts.length > 0) {
                const { error: insertError } = await supabase.from('assignments').insert(inserts);
                if (insertError) throw insertError;
            }

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
            await supabase.from('clients').update({ google_template_id: templateId }).eq('id', clientId);
            setMessage({ type: 'success', text: 'テンプレートIDを保存しました' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '保存失敗' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleStaff = (staffId: string) => {
        setAssignedStaffIds(prev => prev.includes(staffId) ? prev.filter(id => id !== staffId) : [...prev, staffId]);
    };

    const handleCopy = async (sourceType: 'standard' | 'client', sourceId: string) => {
        if (!confirm('現在の設定はすべて上書きされます。よろしいですか？')) return;

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
            alert('テンプレートの取得に失敗しました');
        }
    };

    const handleCreateTemplate = async () => {
        if (!currentOrg || !clientName) return;

        if (templateId) {
            if (!confirm('既にテンプレートIDが入力されています。新しく作成して上書きしますか？')) return;
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
                orgFolderId: orgData.google_folder_id,
                clientName: clientName,
                currentFolderId: clientData?.google_folder_id
            });
            
            if (folderRes.status !== 'success') throw new Error('フォルダ作成エラー: ' + folderRes.message);
            
            if (folderRes.folderId !== clientData?.google_folder_id) {
                await supabase.from('clients').update({ google_folder_id: folderRes.folderId }).eq('id', clientId);
            }

            const readableSchema = convertSchemaToReadable(formItems);

            const createRes = await callGasApi({
                action: 'create_template_doc',
                folderId: folderRes.folderId,
                clientName: clientName,
                schema: readableSchema 
            });

            if (createRes.status === 'success') {
                setTemplateId(createRes.docId);
                await supabase.from('clients').update({ google_template_id: createRes.docId }).eq('id', clientId);
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
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e0e0e0', bgcolor: '#fff', flexShrink: 0 }}>
                <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                    <IconButton onClick={() => router.back()}><ArrowBackIcon /></IconButton>
                    <Box>
                        <Typography variant="caption" color="text.secondary">利用者設定</Typography>
                        <Typography variant="h5" fontWeight="bold">{clientName} 様</Typography>
                    </Box>
                </Stack>
                <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="fullWidth">
                    <Tab icon={<DescriptionIcon />} label="記録フォーム" />
                    <Tab icon={<AssignmentIndIcon />} label="担当スタッフ" />
                    <Tab icon={<FolderIcon />} label="帳票・連携" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f5f5f5' }}>
                {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

                {tabIndex === 0 && (
                    <Box>
                        <Box display="flex" justifyContent="flex-end" gap={1} mb={2}>
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
                                <Card key={item.id} sx={{ overflow: 'visible', borderLeft: item.type === 'section' ? '6px solid #2255CC' : 'none', bgcolor: item.type === 'section' ? '#eef2ff' : 'white' }}>
                                    <CardContent sx={{ p: '16px !important' }}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start" spacing={2}>
                                            <Stack direction="column" spacing={0.5}>
                                                <IconButton size="small" onClick={() => moveField(index, 'up')} disabled={index === 0}><ArrowUpwardIcon fontSize="small" /></IconButton>
                                                <IconButton size="small" onClick={() => moveField(index, 'down')} disabled={index === formItems.length - 1}><ArrowDownwardIcon fontSize="small" /></IconButton>
                                                <IconButton color="error" size="small" onClick={() => removeField(index)} sx={{ mt: 1 }}><DeleteIcon fontSize="small" /></IconButton>
                                            </Stack>
                                            <Box sx={{ flexGrow: 1, width: '100%' }}>
                                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={1}>
                                                    <TextField select label="種類" size="small" value={item.type} onChange={(e) => updateField(index, 'type', e.target.value as FormItem['type'])} sx={{ minWidth: 160 }} InputProps={{ startAdornment: item.type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null }}>
                                                        <MenuItem value="section" sx={{ fontWeight: 'bold', color: 'primary.main' }}>■ セクション見出し</MenuItem>
                                                        <Divider /><MenuItem value="checkbox">チェック (ON/OFF)</MenuItem><MenuItem value="multicheckbox">複数選択</MenuItem><MenuItem value="text">テキスト入力</MenuItem><MenuItem value="number">数値入力</MenuItem><MenuItem value="select">1つ選択 (ラジオ)</MenuItem><MenuItem value="time">時間</MenuItem>
                                                    </TextField>
                                                    <TextField label={item.type === 'section' ? "セクション名" : "質問内容"} size="small" fullWidth value={item.label} onChange={(e) => updateField(index, 'label', e.target.value)} sx={{ '& .MuiInputBase-input': { fontWeight: item.type === 'section' ? 'bold' : 'normal', fontSize: item.type === 'section' ? '1.1rem' : '1rem' } }} />
                                                    {item.type !== 'section' && <FormControlLabel control={<Switch size="small" checked={item.required} onChange={(e) => updateField(index, 'required', e.target.checked)} />} label="必須" sx={{ minWidth: 80 }} />}
                                                </Stack>
                                                {(item.type === 'checkbox' || item.type === 'multicheckbox' || item.type === 'select') && (
                                                    <FormControlLabel control={<Switch size="small" color="secondary" checked={!!item.hasDetail} onChange={(e) => updateField(index, 'hasDetail', e.target.checked)} />} label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} sx={{ mb: 1, ml: 1 }} />
                                                )}
                                                {(item.type === 'select' || item.type === 'multicheckbox') && (
                                                    <TextField label="選択肢（カンマ区切り）" size="small" fullWidth value={item.options || ''} onChange={(e) => updateField(index, 'options', e.target.value)} InputProps={{ startAdornment: <CheckBoxIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} /> }} />
                                                )}
                                            </Box>
                                        </Stack>
                                    </CardContent>
                                </Card>
                            ))}
                            <Button variant="outlined" startIcon={<AddCircleIcon />} onClick={addField} size="large" sx={{ border: '2px dashed #ccc', color: '#666', py: 2 }}>項目を追加する</Button>
                        </Stack>
                    </Box>
                )}

                {tabIndex === 1 && (
                    <Card variant="outlined">
                        <CardContent>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>この利用者を担当するスタッフを選択してください</Typography>
                            <Typography variant="body2" color="text.secondary" mb={3}>選択したスタッフのみが、記録入力画面の「担当ヘルパー」選択肢に表示されます。</Typography>
                            <FormGroup>
                                <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, color: 'primary.main' }}>メンバー（ログインユーザー）</Typography>
                                <Box display="flex" flexWrap="wrap" gap={2}>
                                    {allStaffs.filter(s => s.type === 'member').map(staff => (
                                        <FormControlLabel key={staff.id} control={<Checkbox checked={assignedStaffIds.includes(staff.id)} onChange={() => handleToggleStaff(staff.id)} />} label={staff.name} sx={{ minWidth: 150 }} />
                                    ))}
                                </Box>
                                <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, color: 'secondary.main' }}>アカウントなし（転記用）</Typography>
                                <Box display="flex" flexWrap="wrap" gap={2}>
                                    {allStaffs.filter(s => s.type === 'ghost').map(staff => (
                                        <FormControlLabel key={staff.id} control={<Checkbox checked={assignedStaffIds.includes(staff.id)} onChange={() => handleToggleStaff(staff.id)} />} label={staff.name} sx={{ minWidth: 150 }} />
                                    ))}
                                </Box>
                            </FormGroup>
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
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f8f9fa' }}>
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
                                                                <Box key={item.id} width="100%" sx={{ p: 1, border: '1px dashed #ddd', borderRadius: 1 }}>
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
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f8f9fa' }}>
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

            <Paper elevation={3} sx={{ p: 2, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'center', bgcolor: '#fff', flexShrink: 0, zIndex: 10 }}>
                <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={() => { if (tabIndex === 0) handleSaveForm(); if (tabIndex === 1) handleSaveAssignments(); if (tabIndex === 2) handleSaveTemplateId(); }} disabled={isSaving} sx={{ minWidth: 300, fontWeight: 'bold', height: 48 }}>
                    {isSaving ? '保存中...' : '設定を保存'}
                </Button>
            </Paper>

            <Dialog open={openCopyDialog} onClose={() => setOpenCopyDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>記録項目の設定を読み込む</DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <Tabs 
                        value={copyTab} 
                        onChange={(_, v) => setCopyTab(v)} 
                        variant="fullWidth" 
                        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#f8f9fa' }}
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
                                <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2 }}>
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
                                    <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2 }}>
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
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenCopyDialog(false)}>キャンセル</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
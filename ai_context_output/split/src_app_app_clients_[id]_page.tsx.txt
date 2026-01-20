'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Box, Button, Typography, Paper, Stack, TextField,
    MenuItem, IconButton, Card, CardContent, Switch,
    FormControlLabel, Alert, CircularProgress, Dialog,
    DialogTitle, DialogContent, DialogActions, Select, Divider
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
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useWorkspace } from '@/context/WorkspaceContext';

type FormItem = {
    id: string;
    label: string;
    type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
    options?: string;
    required: boolean;
    hasDetail?: boolean;
};

// デフォルトテンプレート
const DEFAULT_TEMPLATE: FormItem[] = [
    { id: 'sec_medical', label: '【医療的ケア・身体介護】', type: 'section', required: false },
    { id: 'sputum_suction', label: '痰等の吸引（気管・口腔）', type: 'checkbox', required: false },
    { id: 'sputum_cleaning', label: '痰等の吸引に関わる物品の清掃等', type: 'checkbox', required: false },
    { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,他', required: false, hasDetail: true },
    { id: 'water_supply', label: '水分補給', type: 'checkbox', required: false },
    { id: 'medication', label: '服薬介助', type: 'checkbox', required: false },
    { id: 'excretion', label: '排泄介助', type: 'checkbox', required: false, hasDetail: true },
    { id: 'urine_disposal', label: '排尿：尿破棄 (ml)', type: 'number', required: false },
    { id: 'oral_care', label: '口腔ケア', type: 'checkbox', required: false },
    { id: 'body_cleaning', label: '清拭・整容介助', type: 'multicheckbox', options: '全身,顔,上肢,下肢,手,足,背,陰部,頭部,臀部,整髪,耳掃除,爪切り,髭剃り,その他', required: false, hasDetail: true },
    { id: 'partial_bath', label: '部分浴', type: 'multicheckbox', options: '手,足,洗髪,陰部洗浄', required: false },
    { id: 'medical_app', label: '処置（シップ・薬・座薬・点眼）', type: 'multicheckbox', options: 'シップ貼付,薬塗布,座薬挿入,点眼', required: false },
    { id: 'change_clothes', label: '更衣介助', type: 'checkbox', required: false, hasDetail: true },
    { id: 'observation', label: '観察', type: 'multicheckbox', options: 'モニター,皮膚,体位置,表情,他', required: false, hasDetail: true },
    { id: 'vital_check', label: 'バイタル測定（実施項目）', type: 'multicheckbox', options: '体温,血圧,脈拍,SpO2,他', required: false, hasDetail: true },
    { id: 'temp_adjust', label: '温度調整', type: 'multicheckbox', options: '体温,室温', required: false },
    { id: 'sec_support', label: '【生活援助・移動支援】', type: 'section', required: false },
    { id: 'position_change', label: '体位・安楽', type: 'multicheckbox', options: '体位交換,良肢位,疼痛緩和,褥瘡予防', required: false },
    { id: 'env_maintenance', label: '環境整備', type: 'checkbox', required: false },
    { id: 'daily_assist_group', label: '日常の補佐', type: 'multicheckbox', options: 'コミュニケーション支援,各関節・筋肉の運動の補助,パソコン等の操作・設定,電話等の補助,書類の整理,家電等の設定・操作,他', required: false, hasDetail: true },
    { id: 'bedding_change', label: '寝具交換', type: 'checkbox', required: false, hasDetail: true },
    { id: 'transfer_assist', label: '移乗介助', type: 'checkbox', required: false },
    { id: 'move_assist', label: '移動介助（手押し車いす）', type: 'checkbox', required: false },
    { id: 'outing_assist', label: '外出介助', type: 'checkbox', required: false },
    { id: 'outing_prep', label: '外出に関する必要物品の用意・後片付', type: 'checkbox', required: false },
    { id: 'sec_housework', label: '【家事・その他】', type: 'section', required: false },
    { id: 'cooking', label: '調理・配膳', type: 'multicheckbox', options: '調理,配膳,下膳,後片付け', required: false },
    { id: 'cleaning', label: '掃除等・ゴミ出し', type: 'multicheckbox', options: '玄関,居間,寝室,台所,廊下,トイレ,浴室,洗面所,物品庫,掃除機,拭き掃除,他', required: false, hasDetail: true },
    { id: 'clothes_mending', label: '衣類の整理・補修', type: 'multicheckbox', options: '衣類の整理,被服の補修', required: false },
    { id: 'proxy_service', label: '代行業務', type: 'multicheckbox', options: '買物,銀行,郵便局,薬受け取り,他', required: false, hasDetail: true },
    { id: 'goods_organize', label: '物品整理', type: 'multicheckbox', options: '医薬品,衣料品,食料品,他', required: false, hasDetail: true },
    { id: 'laundry', label: '洗濯', type: 'multicheckbox', options: '干す,収納', required: false },
    { id: 'consultation', label: '相談援助', type: 'multicheckbox', options: '相談援助,情報収集,提供', required: false },
    { id: 'watching', label: '見守り', type: 'checkbox', required: false },
    { id: 'other_note', label: 'その他', type: 'text', required: false },
    { id: 'hospital_comm', label: '入院時コミュニケーション支援', type: 'checkbox', required: false },
    { id: 'sec_confirm', label: '【確認事項】', type: 'section', required: false },
    { id: 'benefit_change', label: '●給付変更事項', type: 'multicheckbox', options: '時間延長,時間短縮,追加訪問,時間変更', required: false },
    { id: 'exit_check', label: '●退出時確認事項', type: 'multicheckbox', options: '鍵,火元,電気,水道,戸締まり,ガス元栓,ボイラー', required: false },
    { id: 'special_note', label: '《特記事項》', type: 'text', required: false },
];

export default function ClientSettingsPage() {
    const router = useRouter();
    const params = useParams();
    const clientId = params.id as string;
    const { currentOrg, loading: wsLoading } = useWorkspace();

    const [loading, setLoading] = useState(true);
    const [clientName, setClientName] = useState('');

    const [formItems, setFormItems] = useState<FormItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const [openCopyDialog, setOpenCopyDialog] = useState(false);
    const [otherClients, setOtherClients] = useState<{id: string, name: string}[]>([]);
    const [copySourceId, setCopySourceId] = useState('');

    // useCallbackでラップして依存関係を解決
    const fetchClientData = useCallback(async () => {
        try {
            const { data: client } = await supabase.from('clients').select('name').eq('id', clientId).single();
            if (client) setClientName(client.name);

            const { data: template } = await supabase
                .from('form_templates')
                .select('schema')
                .eq('client_id', clientId)
                .maybeSingle();

            if (template?.schema && Array.isArray(template.schema) && template.schema.length > 0) {
                // anyキャストを削除し、FormItem[]型として扱う
                setFormItems(template.schema as FormItem[]);
            } else {
                const initItems = DEFAULT_TEMPLATE.map(item => ({ ...item, id: crypto.randomUUID() }));
                setFormItems(initItems);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [clientId]);

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
        const newField: FormItem = {
            id: crypto.randomUUID(),
            label: '',
            type: 'checkbox',
            required: false,
            hasDetail: false
        };
        setFormItems([...formItems, newField]);
    };

    const removeField = (index: number) => {
        if (!confirm('この項目を削除しますか？')) return;
        const newItems = [...formItems];
        newItems.splice(index, 1);
        setFormItems(newItems);
    };

    // any型を FormItem[keyof FormItem] に修正
    const updateField = (index: number, key: keyof FormItem, value: FormItem[keyof FormItem]) => {
        const newItems = [...formItems];
        // 型安全な代入のためにスプレッド構文を使用
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

    const handleSave = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const { data: existing } = await supabase.from('form_templates').select('id').eq('client_id', clientId).maybeSingle();
            if (existing) {
                await supabase.from('form_templates').update({ schema: formItems, updated_at: new Date() }).eq('client_id', clientId);
            } else {
                await supabase.from('form_templates').insert({ client_id: clientId, schema: formItems });
            }
            setMessage({ type: 'success', text: '設定を保存しました！' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: '保存に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopy = async () => {
        if (!copySourceId) return;
        try {
            const { data: template } = await supabase.from('form_templates').select('schema').eq('client_id', copySourceId).maybeSingle();
            if (template?.schema) {
                if (confirm('現在の設定はすべて上書きされます。よろしいですか？')) {
                    // anyキャストを FormItem[] に修正
                    const copiedItems = (template.schema as FormItem[]).map(item => ({ ...item, id: crypto.randomUUID() }));
                    setFormItems(copiedItems);
                    setOpenCopyDialog(false);
                    setMessage({ type: 'success', text: '設定をコピーしました' });
                }
            } else {
                alert('設定がありません');
            }
        } catch (error) {
            console.error(error);
        }
    };

    if (loading) return <Box p={4}><CircularProgress /></Box>;

    return (
        <Box sx={{ p: 3, pb: 12, bgcolor: '#f5f5f5', minHeight: '100vh' }}>
            <Paper elevation={0} sx={{ p: 2, mb: 3, border: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Stack direction="row" alignItems="center" spacing={2}>
                    <IconButton onClick={() => router.back()}><ArrowBackIcon /></IconButton>
                    <Box>
                        <Typography variant="caption" color="text.secondary">記録フォーム設定</Typography>
                        <Typography variant="h5" fontWeight="bold">{clientName} 様</Typography>
                    </Box>
                </Stack>
                <Stack direction="row" spacing={1}>
                    <Button variant="outlined" color="secondary" onClick={() => { if (confirm('画像と同じ標準設定に戻しますか？')) setFormItems(DEFAULT_TEMPLATE.map(i => ({ ...i, id: crypto.randomUUID() }))) }}>
                        標準設定に戻す
                    </Button>
                    <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => setOpenCopyDialog(true)} disabled={otherClients.length === 0}>
                        他の人からコピー
                    </Button>
                </Stack>
            </Paper>

            {message && <Alert severity={message.type} sx={{ mb: 3 }}>{message.text}</Alert>}

            <Stack spacing={2}>
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
                                        <TextField
                                            select label="種類" size="small" value={item.type} onChange={(e) => updateField(index, 'type', e.target.value as FormItem['type'])} sx={{ minWidth: 160 }}
                                            InputProps={{ startAdornment: item.type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null }}
                                        >
                                            <MenuItem value="section" sx={{ fontWeight: 'bold', color: 'primary.main' }}>■ セクション見出し</MenuItem>
                                            <Divider />
                                            <MenuItem value="checkbox">チェック (ON/OFF)</MenuItem>
                                            <MenuItem value="multicheckbox">複数選択</MenuItem>
                                            <MenuItem value="text">テキスト入力</MenuItem>
                                            <MenuItem value="number">数値入力</MenuItem>
                                            <MenuItem value="select">1つ選択 (ラジオ)</MenuItem>
                                            <MenuItem value="time">時間</MenuItem>
                                        </TextField>
                                        <TextField
                                            label={item.type === 'section' ? "セクション名" : "質問内容"} size="small" fullWidth value={item.label} onChange={(e) => updateField(index, 'label', e.target.value)}
                                            sx={{ '& .MuiInputBase-input': { fontWeight: item.type === 'section' ? 'bold' : 'normal', fontSize: item.type === 'section' ? '1.1rem' : '1rem' } }}
                                        />
                                        {item.type !== 'section' && (
                                            <FormControlLabel control={<Switch size="small" checked={item.required} onChange={(e) => updateField(index, 'required', e.target.checked)} />} label="必須" sx={{ minWidth: 80 }} />
                                        )}
                                    </Stack>

                                    {/* 詳細入力オプション */}
                                    {(item.type === 'checkbox' || item.type === 'multicheckbox' || item.type === 'select') && (
                                        <FormControlLabel
                                            control={<Switch size="small" color="secondary" checked={!!item.hasDetail} onChange={(e) => updateField(index, 'hasDetail', e.target.checked)} />}
                                            label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>}
                                            sx={{ mb: 1, ml: 1 }}
                                        />
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

            <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, p: 2, zIndex: 100, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'center' }}>
                <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={handleSave} disabled={isSaving} sx={{ minWidth: 300, fontWeight: 'bold', height: 48 }}>{isSaving ? '保存中...' : 'この設定を保存する'}</Button>
            </Paper>

            <Dialog open={openCopyDialog} onClose={() => setOpenCopyDialog(false)}>
                <DialogTitle>設定のコピー</DialogTitle>
                <DialogContent dividers sx={{ minWidth: 300 }}>
                    <Select fullWidth value={copySourceId} displayEmpty onChange={(e) => setCopySourceId(e.target.value)}>
                        <MenuItem value="" disabled>利用者を選択</MenuItem>
                        {otherClients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                    </Select>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenCopyDialog(false)}>キャンセル</Button>
                    <Button onClick={handleCopy} variant="contained" disabled={!copySourceId}>コピー実行</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
'use client';

import { useState } from 'react';
import {
    Box, Button, Card, CardContent, Stack, TextField, MenuItem, Divider,
    FormControlLabel, Switch, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    Tabs, Tab, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import TitleIcon from '@mui/icons-material/Title';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';

import { supabase } from '@/lib/supabase';
import { FormItem, STANDARD_TEMPLATES } from '@/constants/formTemplates';

type Props = {
    clientId: string;
    formItems: FormItem[];
    setFormItems: React.Dispatch<React.SetStateAction<FormItem[]>>;
    otherClients: { id: string; name: string }[];
    showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void;
};

export function FormSettingsTab({ formItems, setFormItems, otherClients, showToast }: Props) {
    const [openCopyDialog, setOpenCopyDialog] = useState(false);
    const [copyTab, setCopyTab] = useState(0);

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
            showToast('設定を反映しました', 'success');
        } else {
            alert('テンプレートの取得に失敗しました');
        }
    };

    return (
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

            {/* コピーダイアログ */}
            <Dialog open={openCopyDialog} onClose={() => setOpenCopyDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>記録項目の設定を読み込む</DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <Tabs value={copyTab} onChange={(_, v) => setCopyTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#f8f9fa' }}>
                        <Tab icon={<LibraryBooksIcon />} label="標準テンプレート" />
                        <Tab icon={<PersonIcon />} label="他の利用者からコピー" />
                    </Tabs>
                    <Box sx={{ p: 2, minHeight: 300 }}>
                        {copyTab === 0 && (
                            <Stack spacing={2}>
                                <Typography variant="body2" color="text.secondary">用途に合わせて標準的な記録項目セットを一括反映します。</Typography>
                                <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2 }}>
                                    {STANDARD_TEMPLATES.map((tmpl, index) => (
                                        <div key={tmpl.key}>
                                            <ListItem disablePadding>
                                                <ListItemButton onClick={() => handleCopy('standard', tmpl.key)}>
                                                    <ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon>
                                                    <ListItemText primary={<Typography fontWeight="bold">{tmpl.name}</Typography>} secondary={tmpl.description} />
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
                                <Typography variant="body2" color="text.secondary">同じ事業所内の他の利用者の設定をコピーします。</Typography>
                                {otherClients.length === 0 ? (
                                    <Box p={2} bgcolor="#fafafa" textAlign="center"><Typography color="text.secondary">他の利用者がいません</Typography></Box>
                                ) : (
                                    <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2 }}>
                                        {otherClients.map((client, index) => (
                                            <div key={client.id}>
                                                <ListItem disablePadding>
                                                    <ListItemButton onClick={() => handleCopy('client', client.id)}>
                                                        <ListItemIcon><PersonIcon color="secondary" /></ListItemIcon>
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
                <DialogActions><Button onClick={() => setOpenCopyDialog(false)}>キャンセル</Button></DialogActions>
            </Dialog>
        </Box>
    );
}
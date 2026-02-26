'use client';

import React, { useState } from 'react';
import {
    Box, Typography, Paper, Stack, TextField, MenuItem, IconButton, Card, CardContent,
    Switch, FormControlLabel, Divider, Checkbox, FormGroup, Alert, Button, Container, Tabs, Tab,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText
} from '@mui/material';

// Icons
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TitleIcon from '@mui/icons-material/Title';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import SaveIcon from '@mui/icons-material/Save';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DescriptionIcon from '@mui/icons-material/Description';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FolderIcon from '@mui/icons-material/Folder';

/* =========================================================================
   UIモックアップ コンポーネント群（本物のUIを再現）
========================================================================= */

// --- 1. 管理画面の「設定カード」モック ---
const SettingsCardMock = ({
    type, label, required, hasDetail, options
}: {
    type: 'section' | 'checkbox' | 'multicheckbox' | 'text' | 'number' | 'select' | 'time',
    label: string, required?: boolean, hasDetail?: boolean, options?: string
}) => (
    <Card sx={{ overflow: 'visible', borderLeft: type === 'section' ? '6px solid #2255CC' : 'none', bgcolor: type === 'section' ? '#eef2ff' : 'white', mb: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', borderRadius: 2 }}>
        <CardContent sx={{ p: '16px !important' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} alignItems="flex-start" spacing={2}>
                <Stack direction="column" spacing={0.5}>
                    <IconButton size="small"><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small"><ArrowDownwardIcon fontSize="small" /></IconButton>
                    <IconButton color="error" size="small" sx={{ mt: 1 }}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Box sx={{ flexGrow: 1, width: '100%' }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} mb={1}>
                        <TextField 
                            select label="種類" size="small" value={type} sx={{ minWidth: 160 }} 
                            InputProps={{ startAdornment: type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null }}
                        >
                            <MenuItem value={type}>
                                {type === 'section' ? '■ セクション見出し' : 
                                 type === 'checkbox' ? 'チェック (ON/OFF)' : 
                                 type === 'multicheckbox' ? '複数選択' : 
                                 type === 'text' ? 'テキスト入力' :
                                 type === 'number' ? '数値入力' : ''}
                            </MenuItem>
                        </TextField>
                        <TextField 
                            label={type === 'section' ? "セクション名" : "質問内容"} 
                            size="small" fullWidth value={label} 
                            sx={{ '& .MuiInputBase-input': { fontWeight: type === 'section' ? 'bold' : 'normal', fontSize: type === 'section' ? '1.1rem' : '1rem' } }} 
                        />
                        {type !== 'section' && <FormControlLabel control={<Switch size="small" checked={required || false} />} label="必須" sx={{ minWidth: 80 }} />}
                    </Stack>
                    {(type === 'checkbox' || type === 'multicheckbox' || type === 'select') && (
                        <FormControlLabel 
                            control={<Switch size="small" color="secondary" checked={hasDetail || false} />} 
                            label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} 
                            sx={{ mb: 1, ml: 1 }} 
                        />
                    )}
                    {(type === 'select' || type === 'multicheckbox') && (
                        <TextField 
                            label="選択肢（カンマ区切り）" size="small" fullWidth value={options || ''} 
                            InputProps={{ startAdornment: <CheckBoxIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} /> }} 
                        />
                    )}
                </Box>
            </Stack>
        </CardContent>
    </Card>
);

// --- 2. テンプレート読込ダイアログのモック ---
const TemplateDialogMock = ({ tabIndex, setTabIndex }: { tabIndex: number, setTabIndex: (v: number) => void }) => (
    <Box sx={{ position: 'relative', p: { xs: 2, md: 4 }, bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 2, display: 'flex', justifyContent: 'center', my: 2 }}>
        <Paper elevation={24} sx={{ width: 600, maxWidth: '100%', borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
            <Box sx={{ p: 2, px: 3 }}>
                <Typography variant="h6" fontWeight="bold">記録項目の設定を読み込む</Typography>
            </Box>
            <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#f8f9fa' }}>
                <Tab icon={<LibraryBooksIcon />} label="標準テンプレート" />
                <Tab icon={<PersonIcon />} label="他の利用者からコピー" />
            </Tabs>
            <Box sx={{ p: 3, minHeight: 300 }}>
                {tabIndex === 0 && (
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                            用途に合わせて標準的な記録項目セットを一括反映します。<br/>
                            反映後、自由に項目の追加・削除が可能です。
                        </Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }}>
                            <ListItem disablePadding>
                                <ListItemButton>
                                    <ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold">標準セット（重度訪問・総合）</Typography>} secondary="身体介護から生活援助まで網羅したフルセット" />
                                </ListItemButton>
                            </ListItem>
                            <Divider />
                            <ListItem disablePadding>
                                <ListItemButton>
                                    <ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold">身体介護中心</Typography>} secondary="入浴・排泄・食事などの身体ケアに特化" />
                                </ListItemButton>
                            </ListItem>
                            <Divider />
                            <ListItem disablePadding>
                                <ListItemButton>
                                    <ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold">生活援助中心</Typography>} secondary="掃除・洗濯・調理などの家事援助に特化" />
                                </ListItemButton>
                            </ListItem>
                        </List>
                    </Stack>
                )}
                {tabIndex === 1 && (
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                            同じ事業所内の他の利用者の設定をコピーします。
                        </Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }}>
                            <ListItem disablePadding>
                                <ListItemButton>
                                    <ListItemIcon><PersonIcon color="secondary" /></ListItemIcon>
                                    <ListItemText primary="田崎 禎二" />
                                </ListItemButton>
                            </ListItem>
                        </List>
                    </Stack>
                )}
            </Box>
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #eee' }}>
                <Button sx={{ fontWeight: 'bold' }}>キャンセル</Button>
            </Box>
        </Paper>
    </Box>
);

// --- 3. ヘルパーの「入力画面」モック群 ---
const RecordUIMock = ({ children }: { children: React.ReactNode }) => (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', maxWidth: 600, margin: '0 auto', width: '100%' }}>
        <Box sx={{ bgcolor: '#f8f9fa', px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
            <Typography variant="h6" color="text.primary" fontWeight="bold">【医療的ケア・身体介護】</Typography>
        </Box>
        <Stack divider={<Divider />}>
            {children}
        </Stack>
    </Paper>
);

const RecordCheckboxMock = ({ label, detail }: { label: string, detail?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: 'transparent' }}>
        <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                <Typography variant="subtitle1" fontWeight={detail ? "bold" : "normal"} color={detail ? "primary.main" : "text.primary"}>
                    {label}
                </Typography>
                <Switch checked={detail} color="primary" />
            </Box>
            {detail && (
                <TextField placeholder="詳細... (例: 軟便少量あり)" fullWidth size="small" sx={{ mt: 1 }} />
            )}
        </Box>
    </Box>
);

const RecordMultiCheckboxMock = ({ label, required, options, detail }: { label: string, required?: boolean, options: string[], detail?: boolean }) => (
    <Box sx={{ p: 3 }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>
            {label} {required && <Typography component="span" color="error">*</Typography>}
        </Typography>
        <FormGroup row sx={{ gap: 1 }}>
            {options.map((opt, i) => {
                const checked = i === 0 || i === 4; // 例として1番目と5番目をチェック
                return (
                    <FormControlLabel 
                        key={opt} 
                        control={<Checkbox size="small" checked={checked} />} 
                        label={<Typography variant="body2" fontWeight={checked ? 'bold' : 'normal'}>{opt}</Typography>} 
                        sx={{ 
                            mr: 2, mb: 1, border: '1px solid', borderRadius: 2, px: 1.5, py: 0.5, mx: 0, 
                            bgcolor: checked ? '#eef2ff' : 'transparent', 
                            borderColor: checked ? 'primary.main' : 'divider' 
                        }} 
                    />
                );
            })}
        </FormGroup>
        {detail && (
            <TextField placeholder="詳細..." fullWidth size="small" sx={{ mt: 1 }} />
        )}
    </Box>
);

const RecordNumberMock = ({ label, required, error }: { label: string, required?: boolean, error?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: error ? '#fff5f5' : 'transparent' }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>
            {label} {required && <Typography component="span" color="error">*</Typography>}
        </Typography>
        <TextField 
            fullWidth variant="outlined" type="number" 
            placeholder={`${label}を入力`} 
            error={error} 
            helperText={error ? "必須項目です" : ""} 
        />
    </Box>
);

// --- 4. レイアウト用ブロック ---
const StepBlock = ({ title, desc, children }: { title: React.ReactNode, desc?: React.ReactNode, children: React.ReactNode }) => (
    <Box mb={8}>
        <Typography variant="h5" fontWeight="bold" color="primary.main" gutterBottom sx={{ borderBottom: '3px solid', borderColor: 'primary.main', pb: 1, display: 'inline-block' }}>
            {title}
        </Typography>
        {desc && (
            <Typography variant="body1" paragraph sx={{ mt: 2, mb: 3, lineHeight: 1.8 }}>
                {desc}
            </Typography>
        )}
        <Box mt={3}>
            {children}
        </Box>
    </Box>
);


/* =========================================================================
   メインページ
========================================================================= */
export default function FormSettingsManualPage() {
    const [dialogTab, setDialogTab] = useState(0);

    return (
        // ★重要: globals.css の overflow: hidden に打ち勝つための設定
        <Box sx={{ height: '100vh', overflowY: 'auto', bgcolor: '#f5f5f5', pb: 10 }}>
            
            {/* 実際のUIを模した固定ヘッダー */}
            <Box sx={{ borderBottom: '1px solid #e0e0e0', bgcolor: '#fff', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <Stack direction="row" alignItems="center" spacing={2} mb={2} px={3} pt={2}>
                    <IconButton><ArrowBackIcon /></IconButton>
                    <Box>
                        <Typography variant="caption" color="text.secondary">利用者設定</Typography>
                        <Typography variant="h5" fontWeight="bold">aaa 様</Typography>
                    </Box>
                </Stack>
                <Tabs value={0} variant="fullWidth">
                    <Tab icon={<DescriptionIcon />} label="記録フォーム" />
                    <Tab icon={<AssignmentIndIcon />} label="担当スタッフ" />
                    <Tab icon={<FolderIcon />} label="帳票・連携" />
                </Tabs>
            </Box>

            {/* 本文エリア */}
            <Container maxWidth="lg" sx={{ pt: 6 }}>
                <Box textAlign="center" mb={6}>
                    <Typography variant="h3" fontWeight="bold" color="#333" gutterBottom>
                        記録フォーム設定マニュアル
                    </Typography>
                    <Typography variant="subtitle1" color="text.secondary">
                        現場のヘルパーが入力する「記録フォーム」を、利用者ごとにカスタマイズする方法を解説します。
                    </Typography>
                </Box>

                {/* 1. テンプレートの読み込み */}
                <StepBlock 
                    title="1. テンプレートの読み込み（一括設定）"
                    desc="1からすべての項目を作成するのは大変なため、まずは右上の「テンプレート読込 / コピー」ボタンからひな形を読み込むのがおすすめです。用途に合わせて標準的なセットを一括反映し、後から不要なものを削除したり追加したりして調整します。"
                >
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        <b>ご注意：</b>テンプレートを読み込むと、現在画面に入力されている項目はすべて上書き（リセット）されます。
                    </Alert>
                    
                    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0' }}>
                        <Box display="flex" justifyContent="flex-end" mb={2}>
                            <Button variant="outlined" startIcon={<ContentCopyIcon />} sx={{ bgcolor: '#fff', fontWeight: 'bold' }}>
                                テンプレート読込 / コピー
                            </Button>
                        </Box>
                        {/* ダイアログの完全再現 */}
                        <TemplateDialogMock tabIndex={dialogTab} setTabIndex={setDialogTab} />
                    </Box>
                </StepBlock>


                {/* 2. 質問の種類 */}
                <StepBlock 
                    title="2. 質問の種類（入力形式）について"
                    desc="「種類」のメニューから、ヘルパーにどのように入力してほしいかを選択します。種類によって入力画面のデザインが自動的に切り替わります。"
                >
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4} alignItems="stretch">
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">⚙️ 管理者の「設定画面」</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <SettingsCardMock type="section" label="【医療的ケア・身体介護】" />
                                <SettingsCardMock type="checkbox" label="食事介助" />
                                <SettingsCardMock type="multicheckbox" label="排泄介助" options="トイレ誘導,オムツ交換" />
                            </Box>
                        </Box>
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">📱 ヘルパーの「入力画面」の見え方</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <RecordUIMock>
                                    <RecordCheckboxMock label="食事介助" />
                                    <RecordMultiCheckboxMock label="排泄介助" options={['トイレ誘導', 'オムツ交換']} />
                                </RecordUIMock>
                            </Box>
                        </Box>
                    </Stack>
                </StepBlock>

                {/* 3. 詳細入力を許可 */}
                <StepBlock 
                    title="3. 「詳細入力を許可」機能"
                    desc="チェックボックスや選択肢形式の質問において、「はい/いいえ」を選ぶだけでなく、補足のテキストメモ（詳細）を残せるようにする機能です。現場のヘルパーがチェックを入れた時だけ、自動的に詳細入力欄が表示されます。"
                >
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4} alignItems="stretch">
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">⚙️ 管理者の「設定画面」</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <SettingsCardMock type="checkbox" label="排泄介助" hasDetail={true} />
                            </Box>
                        </Box>
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">📱 ヘルパーの「入力画面」の見え方</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <RecordUIMock>
                                    <RecordCheckboxMock label="排泄介助" detail={true} />
                                </RecordUIMock>
                            </Box>
                        </Box>
                    </Stack>
                </StepBlock>

                {/* 4. 選択肢の入力方法 */}
                <StepBlock 
                    title="4. 選択肢の入力方法"
                    desc="種類を「複数選択」または「1つ選択 (ラジオ)」にした場合、「選択肢（カンマ区切り）」の入力欄が表示されます。選択肢同士を 半角カンマ ( , ) または 読点 ( 、 ) で区切って入力すると、自動でボタンが生成されます。"
                >
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4} alignItems="stretch">
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">⚙️ 管理者の「設定画面」</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <SettingsCardMock type="multicheckbox" label="清拭・整容介助" hasDetail={true} options="全身, 顔, 上肢, 下肢, 清拭, 入浴介助" />
                            </Box>
                        </Box>
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">📱 ヘルパーの「入力画面」の見え方</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <RecordUIMock>
                                    <RecordMultiCheckboxMock label="清拭・整容介助" options={['全身', '顔', '上肢', '下肢', '清拭', '入浴介助']} detail={true} />
                                </RecordUIMock>
                            </Box>
                        </Box>
                    </Stack>
                </StepBlock>

                {/* 5. 必須入力の設定 */}
                <StepBlock 
                    title="5. 必須入力の設定"
                    desc="「必須」スイッチをONにすると、その項目は入力必須になります。必須にした項目をヘルパーが未入力のまま「送信」ボタンを押すとエラーとなり、送信できなくなります。絶対に記録してほしい項目にはONにしてください。"
                >
                    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4} alignItems="stretch">
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">⚙️ 管理者の「設定画面」</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <SettingsCardMock type="number" label="尿破棄 (ml)" required={true} />
                            </Box>
                        </Box>
                        <Box flex={1}>
                            <Typography variant="subtitle2" color="text.secondary" mb={1} fontWeight="bold">📱 ヘルパーの「入力画面」の見え方</Typography>
                            <Box sx={{ p: 2, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', height: '100%' }}>
                                <RecordUIMock>
                                    <RecordNumberMock label="尿破棄 (ml)" required={true} error={true} />
                                </RecordUIMock>
                            </Box>
                        </Box>
                    </Stack>
                </StepBlock>

                {/* 6. 項目の追加・削除・保存 */}
                <StepBlock 
                    title="6. 項目の追加・削除・並び替え"
                    desc="一番下にある点線の「＋ 項目を追加する」ボタンを押すと、新しい空の質問が追加されます。各項目の左下にある赤い「ゴミ箱」アイコンを押すと、その項目を削除できます。項目の左側にある「↑（上へ）」「↓（下へ）」ボタンをクリックすることで、質問の順番を入れ替えることができます。"
                >
                    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0' }}>
                        <SettingsCardMock type="text" label="特記事項" />
                        
                        <Button variant="outlined" startIcon={<AddCircleIcon />} size="large" sx={{ border: '2px dashed #ccc', color: '#666', py: 2, width: '100%', bgcolor: '#fafafa', mb: 4 }}>
                            項目を追加する
                        </Button>

                        <Paper elevation={3} sx={{ p: 2, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'center', bgcolor: '#fff' }}>
                            <Stack alignItems="center" spacing={1}>
                                <Typography variant="body2" color="error" fontWeight="bold">
                                    ※ 設定が完了したら、忘れずに下のボタンを押して保存してください。
                                </Typography>
                                <Button variant="contained" size="large" startIcon={<SaveIcon />} sx={{ minWidth: 300, fontWeight: 'bold', height: 48 }}>
                                    設定を保存
                                </Button>
                            </Stack>
                        </Paper>
                    </Box>
                </StepBlock>

            </Container>
        </Box>
    );
}
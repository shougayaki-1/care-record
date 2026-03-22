'use client';

import { Fragment, ReactNode } from 'react';
import {
    Box, Typography, Paper, Stack, TextField, MenuItem, IconButton, Card, CardContent,
    Switch, FormControlLabel, Divider, Checkbox, FormGroup, Alert, Button, Container, Tabs, Tab,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText, RadioGroup, Radio,
    Avatar, Table, TableHead, TableBody, TableRow, TableCell, Chip
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
import DescriptionIcon from '@mui/icons-material/Description';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FolderIcon from '@mui/icons-material/Folder';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import BusinessIcon from '@mui/icons-material/Business';
import BadgeIcon from '@mui/icons-material/Badge';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import TagIcon from '@mui/icons-material/Tag';

/* =========================================================================
   UIモックアップ コンポーネント群（操作不可にするため pointerEvents: 'none'）
========================================================================= */

// --- ナビゲーション画面のモック（Step 0用） ---
const NumberBadge = ({ number }: { number: number }) => (
    <Box
        sx={{
            position: 'absolute',
            top: -12,
            left: -12,
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: '#ff1744',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            zIndex: 20,
            border: '2px solid white'
        }}
    >
        {number}
    </Box>
);

const NavigationScreenMock = () => {
    return (
        <Box sx={{ display: 'flex', height: 500, border: '1px solid #ddd', borderRadius: 2, overflow: 'hidden', bgcolor: '#f5f5f5', pointerEvents: 'none', userSelect: 'none' }}>
            {/* 1. 左端レール */}
            <Box sx={{ width: 60, bgcolor: '#E3E5E8', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2, gap: 2, borderRight: '1px solid #d0d0d0' }}>
                <Avatar sx={{ bgcolor: '#2255CC', width: 40, height: 40, fontSize: '0.9rem' }}>社</Avatar>
                <Avatar sx={{ bgcolor: '#fff', color: '#23A559', width: 40, height: 40 }}><AddIcon /></Avatar>
            </Box>

            {/* 2. サイドバー */}
            <Box sx={{ width: 220, bgcolor: '#F2F3F5', display: { xs: 'none', sm: 'flex' }, flexDirection: 'column', borderRight: '1px solid #e0e0e0' }}>
                <Box p={2} borderBottom="1px solid #e0e0e0"><Typography variant="subtitle2" fontWeight="bold">一般社団法人賢祥会</Typography></Box>
                <Box flexGrow={1} py={1}>
                    <Typography variant="caption" sx={{ px: 2, py: 1, color: '#666', fontWeight: 'bold' }}>記録</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><EditNoteIcon fontSize="small" /></ListItemIcon><ListItemText primary="記録を作成" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><HistoryIcon fontSize="small" /></ListItemIcon><ListItemText primary="自分の履歴" /></ListItemButton></ListItem>
                    </List>
                    
                    <Typography variant="caption" sx={{ px: 2, py: 1, color: '#666', fontWeight: 'bold', display: 'block', mt: 1 }}>提供記録一覧</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><TagIcon fontSize="small" /></ListItemIcon><ListItemText primary="全件表示" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><WarningAmberIcon fontSize="small" /></ListItemIcon><ListItemText primary="未承認・差戻し" /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><CalendarMonthIcon fontSize="small" /></ListItemIcon><ListItemText primary="今月の記録" /></ListItemButton></ListItem>
                    </List>

                    <Typography variant="caption" sx={{ px: 2, py: 1, color: '#666', fontWeight: 'bold', display: 'block', mt: 1 }}>管理</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><BusinessIcon fontSize="small" /></ListItemIcon><ListItemText primary="事業所設定" /></ListItemButton></ListItem>
                        
                        {/* ★ここをクリックさせる */}
                        <Box sx={{ position: 'relative', mx: 1, mt: 0.5 }}>
                            <NumberBadge number={1} />
                            <Box sx={{ border: '3px solid #ff1744', borderRadius: 1, bgcolor: 'rgba(255, 23, 68, 0.05)' }}>
                                <ListItemButton selected sx={{ borderRadius: 1, pl: 1 }}>
                                    <ListItemIcon sx={{ minWidth: 36 }}><PeopleIcon fontSize="small" color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold" color="primary.main">利用者管理</Typography>} />
                                </ListItemButton>
                            </Box>
                        </Box>

                        <ListItem disablePadding><ListItemButton><ListItemIcon sx={{ minWidth: 36 }}><BadgeIcon fontSize="small" /></ListItemIcon><ListItemText primary="スタッフ管理" /></ListItemButton></ListItem>
                    </List>
                </Box>
                <Box p={2} bgcolor="#EBEDEF" display="flex" alignItems="center" gap={1}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>安</Avatar>
                    <Box><Typography variant="caption" fontWeight="bold" display="block">安部 祥太朗</Typography><Typography variant="caption" fontSize={10} color="text.secondary">オンライン</Typography></Box>
                </Box>
            </Box>

            {/* 3. メインエリア */}
            <Box sx={{ flexGrow: 1, bgcolor: '#fff', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ height: 60, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', px: 3, justifyContent: 'space-between' }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <PeopleIcon color="action" />
                        <Typography variant="h6" fontWeight="bold">利用者管理</Typography>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={2}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', fontSize: 14 }}>
                            <Switch size="small" /> アーカイブを表示
                        </Box>
                    </Stack>
                </Box>

                <Box sx={{ p: 3, flexGrow: 1, bgcolor: '#f9f9f9' }}>
                    <Box display="flex" justifyContent="flex-end" mb={2}>
                        <Button variant="contained" size="small" startIcon={<AddIcon />}>新規登録</Button>
                    </Box>

                    <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden' }}>
                        <Table size="small">
                            <TableHead sx={{ bgcolor: '#f5f5f5' }}>
                                <TableRow>
                                    <TableCell>利用者氏名</TableCell>
                                    <TableCell>状態</TableCell>
                                    <TableCell align="right">操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow hover>
                                    <TableCell>aaa</TableCell>
                                    <TableCell><Chip label="有効" color="success" size="small" variant="outlined" /></TableCell>
                                    <TableCell align="right">
                                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                                            <IconButton size="small"><EditIcon fontSize="small" /></IconButton>
                                            
                                            {/* ★ここをクリックさせる */}
                                            <Box sx={{ position: 'relative' }}>
                                                <NumberBadge number={2} />
                                                <Box sx={{ border: '3px solid #ff1744', borderRadius: 1, display: 'inline-block' }}>
                                                    <IconButton size="small" color="primary" sx={{ bgcolor: '#eef2ff' }}>
                                                        <SettingsIcon fontSize="small" />
                                                    </IconButton>
                                                </Box>
                                            </Box>
                                            
                                            <IconButton size="small"><ArchiveIcon fontSize="small" /></IconButton>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell>あいう エオ</TableCell>
                                    <TableCell><Chip label="有効" color="success" size="small" variant="outlined" /></TableCell>
                                    <TableCell align="right">
                                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                                            <IconButton size="small"><EditIcon fontSize="small" /></IconButton>
                                            <IconButton size="small" color="primary"><SettingsIcon fontSize="small" /></IconButton>
                                            <IconButton size="small"><ArchiveIcon fontSize="small" /></IconButton>
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </Paper>
                </Box>
            </Box>
        </Box>
    );
}

// --- その他のモック ---

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
                        <TextField select label="種類" size="small" value={type} sx={{ minWidth: 160 }} InputProps={{ startAdornment: type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null }}>
                            <MenuItem value={type}>
                                {type === 'section' ? '■ セクション見出し' : 
                                 type === 'checkbox' ? 'チェック (ON/OFF)' : 
                                 type === 'multicheckbox' ? '複数選択' : 
                                 type === 'text' ? 'テキスト入力' : 
                                 type === 'number' ? '数値入力' : 
                                 type === 'select' ? '1つ選択 (ラジオ)' : 
                                 type === 'time' ? '時間' : ''}
                            </MenuItem>
                        </TextField>
                        <TextField label={type === 'section' ? "セクション名" : "質問内容"} size="small" fullWidth value={label} sx={{ '& .MuiInputBase-input': { fontWeight: type === 'section' ? 'bold' : 'normal', fontSize: type === 'section' ? '1.1rem' : '1rem' } }} />
                        {type !== 'section' && <FormControlLabel control={<Switch size="small" checked={required || false} />} label="必須" sx={{ minWidth: 80 }} />}
                    </Stack>
                    {(type === 'checkbox' || type === 'multicheckbox' || type === 'select') && (
                        <FormControlLabel control={<Switch size="small" color="secondary" checked={hasDetail || false} />} label={<Box display="flex" alignItems="center" gap={0.5}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} sx={{ mb: 1, ml: 1 }} />
                    )}
                    {(type === 'select' || type === 'multicheckbox') && (
                        <TextField label="選択肢（カンマ区切り）" size="small" fullWidth value={options || ''} InputProps={{ startAdornment: <CheckBoxIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} /> }} />
                    )}
                </Box>
            </Stack>
        </CardContent>
    </Card>
);

const TemplateDialogMock = ({ tabIndex }: { tabIndex: number }) => (
    <Box sx={{ position: 'relative', p: { xs: 2, md: 4 }, bgcolor: 'rgba(0,0,0,0.05)', borderRadius: 2, display: 'flex', justifyContent: 'center', my: 2 }}>
        <Paper elevation={4} sx={{ width: 600, maxWidth: '100%', borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
            <Box sx={{ p: 2, px: 3 }}><Typography variant="h6" fontWeight="bold">記録項目の設定を読み込む</Typography></Box>
            <Tabs value={tabIndex} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: '#f8f9fa' }}>
                <Tab icon={<LibraryBooksIcon />} label="標準テンプレート" />
                <Tab icon={<PersonIcon />} label="他の利用者からコピー" />
            </Tabs>
            <Box sx={{ p: 3, minHeight: 250 }}>
                {tabIndex === 0 && (
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">用途に合わせて標準的な記録項目セットを一括反映します。<br/>反映後、自由に項目の追加・削除が可能です。</Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }}>
                            <ListItem disablePadding><ListItemButton><ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon><ListItemText primary={<Typography fontWeight="bold">標準セット（重度訪問・総合）</Typography>} secondary="身体介護から生活援助まで網羅したフルセット" /></ListItemButton></ListItem>
                            <Divider />
                            <ListItem disablePadding><ListItemButton><ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon><ListItemText primary={<Typography fontWeight="bold">身体介護中心</Typography>} secondary="入浴・排泄・食事などの身体ケアに特化" /></ListItemButton></ListItem>
                            <Divider />
                            <ListItem disablePadding><ListItemButton><ListItemIcon><ContentPasteIcon color="primary" /></ListItemIcon><ListItemText primary={<Typography fontWeight="bold">生活援助中心</Typography>} secondary="掃除・洗濯・調理などの家事援助に特化" /></ListItemButton></ListItem>
                        </List>
                    </Stack>
                )}
                {tabIndex === 1 && (
                    <Stack spacing={2}>
                        <Typography variant="body2" color="text.secondary">同じ事業所内の他の利用者の設定をコピーします。</Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }}>
                            <ListItem disablePadding><ListItemButton><ListItemIcon><PersonIcon color="secondary" /></ListItemIcon><ListItemText primary="鈴木 一郎" /></ListItemButton></ListItem>
                            <Divider />
                            <ListItem disablePadding><ListItemButton><ListItemIcon><PersonIcon color="secondary" /></ListItemIcon><ListItemText primary="佐藤 花子" /></ListItemButton></ListItem>
                        </List>
                    </Stack>
                )}
            </Box>
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #eee' }}><Button sx={{ fontWeight: 'bold' }}>キャンセル</Button></Box>
        </Paper>
    </Box>
);

const RecordUIMock = ({ title, children }: { title?: string, children: ReactNode }) => (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', maxWidth: 600, margin: '0 auto', width: '100%' }}>
        {title && (
            <Box sx={{ bgcolor: '#f8f9fa', px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                <Box sx={{ width: 6, height: 28, bgcolor: 'primary.main', borderRadius: 1, mr: 2, flexShrink: 0 }} />
                <Typography variant="h6" color="text.primary" fontWeight="bold">{title}</Typography>
            </Box>
        )}
        <Stack divider={<Divider />}>{children}</Stack>
    </Paper>
);

const RecordCheckboxMock = ({ label, detail }: { label: string, detail?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: 'transparent' }}>
        <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                <Typography variant="subtitle1" fontWeight={detail ? "bold" : "normal"} color={detail ? "primary.main" : "text.primary"}>{label}</Typography>
                <Switch checked={detail} color="primary" />
            </Box>
            {detail && <TextField placeholder="詳細... (例: 軟便少量あり)" fullWidth size="small" sx={{ mt: 1 }} />}
        </Box>
    </Box>
);

const RecordMultiCheckboxMock = ({ label, required, options, detail }: { label: string, required?: boolean, options: string[], detail?: boolean }) => (
    <Box sx={{ p: 3 }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <FormGroup row sx={{ gap: 1 }}>
            {options.map((opt, i) => {
                const checked = i === 0 || i === 4;
                return (
                    <Fragment key={opt}>
                        <FormControlLabel control={<Checkbox size="small" checked={checked} />} label={<Typography variant="body2" fontWeight={checked ? 'bold' : 'normal'}>{opt}</Typography>} sx={{ mr: 2, mb: 1, border: '1px solid', borderRadius: 2, px: 1.5, py: 0.5, mx: 0, bgcolor: checked ? '#eef2ff' : 'transparent', borderColor: checked ? 'primary.main' : 'divider' }} />
                    </Fragment>
                );
            })}
        </FormGroup>
        {detail && <TextField placeholder="詳細..." fullWidth size="small" sx={{ mt: 1 }} />}
    </Box>
);

const RecordRadioMock = ({ label, required, options, detail }: { label: string, required?: boolean, options: string[], detail?: boolean }) => (
    <Box sx={{ p: 3 }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1.5, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <RadioGroup row value={options[0]}>
            {options.map((opt) => (
                <FormControlLabel key={opt} value={opt} control={<Radio size="small" />} label={<Typography variant="body2" fontWeight={opt === options[0] ? 'bold' : 'normal'}>{opt}</Typography>} sx={{ mr: 3 }} />
            ))}
        </RadioGroup>
        {detail && <TextField placeholder="詳細..." fullWidth size="small" sx={{ mt: 1 }} />}
    </Box>
);

const RecordTextMock = ({ label, required }: { label: string, required?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: 'transparent' }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" multiline minRows={3} placeholder={`${label}を入力`} />
    </Box>
);

const RecordNumberMock = ({ label, required, error }: { label: string, required?: boolean, error?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: error ? '#fff5f5' : 'transparent' }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" type="number" placeholder={`${label}を入力`} error={error} helperText={error ? "必須項目です" : ""} />
    </Box>
);

const RecordTimeMock = ({ label, required }: { label: string, required?: boolean }) => (
    <Box sx={{ p: 3, bgcolor: 'transparent' }}>
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" type="time" InputLabelProps={{ shrink: true }} defaultValue="12:00" />
    </Box>
);

const StepBlock = ({ title, desc, children }: { title: ReactNode, desc?: ReactNode, children: ReactNode }) => (
    <Box mb={8}>
        <Typography variant="h5" fontWeight="bold" color="primary.main" gutterBottom sx={{ borderBottom: '3px solid', borderColor: 'primary.main', pb: 1, display: 'inline-block' }}>{title}</Typography>
        {desc && <Typography variant="body1" paragraph sx={{ mt: 2, mb: 3, lineHeight: 1.8 }}>{desc}</Typography>}
        <Box mt={3}>{children}</Box>
    </Box>
);

const ComparisonBlock = ({
    title, desc, settingUI, inputUI, mockTitle = "【各種介助】"
}: {
    title?: string, desc?: string, settingUI: ReactNode, inputUI: ReactNode, mockTitle?: string | null
}) => (
    <Box mb={5}>
        {title && <Typography variant="h6" fontWeight="bold" color="primary.main" gutterBottom>■ {title}</Typography>}
        {desc && <Typography variant="body2" color="text.secondary" mb={2}>{desc}</Typography>}
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="stretch">
            {/* 設定UI */}
            <Box flex={1} sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                <Box p={2} bgcolor="#f0f2f5" borderRadius={3} border="1px solid #e0e0e0" height="100%" display="flex" flexDirection="column" justifyContent="center">
                    {settingUI}
                </Box>
            </Box>
            {/* 入力UI */}
            <Box flex={1} sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                <Box p={2} bgcolor="#f0f2f5" borderRadius={3} border="1px solid #e0e0e0" height="100%" display="flex" flexDirection="column" justifyContent="center">
                    <RecordUIMock title={mockTitle || undefined}>
                        {inputUI}
                    </RecordUIMock>
                </Box>
            </Box>
        </Stack>
    </Box>
);

/* =========================================================================
   メインページ
========================================================================= */
export default function FormSettingsManualPage() {
    return (
        <Box sx={{ bgcolor: '#fff', pb: 10 }}>
            {/* ヘッダー部分 */}
            <Box sx={{ bgcolor: '#2255CC', color: 'white', py: { xs: 4, md: 8 }, mb: 6, textAlign: 'center' }}>
                <Container maxWidth="md">
                    <Typography variant="h3" fontWeight="bold" gutterBottom sx={{ fontSize: { xs: '1.8rem', md: '3rem' } }}>
                        記録フォーム設定マニュアル
                    </Typography>
                    <Typography variant="h6" fontWeight="normal" sx={{ opacity: 0.9, fontSize: { xs: '1rem', md: '1.25rem' } }}>
                        利用者ごとに最適な記録項目（フォーム）をカスタマイズする方法と、<br />実際の現場のヘルパーの入力画面の見え方を解説します。
                    </Typography>
                </Container>
            </Box>

            {/* 本文エリア */}
            <Container maxWidth="lg">

                {/* 0. フォーム設定画面の開き方 */}
                <StepBlock title="0. フォーム設定画面の開き方" desc="アプリのメニューから、利用者ごとのフォーム設定画面を開く手順です。">
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle1" fontWeight="bold" mb={2}>
                            <span style={{ color: '#ff1744', fontWeight: 'bold' }}>① サイドメニュー</span> から「利用者管理」を選択し、
                            <span style={{ color: '#ff1744', fontWeight: 'bold', marginLeft: 8 }}>② 利用者一覧</span> の右側にある「設定（歯車）」アイコンをクリックしてください。
                        </Typography>
                    </Box>
                    <NavigationScreenMock />
                </StepBlock>

                {/* 1. テンプレートの読み込み */}
                <StepBlock title="1. テンプレートの読み込み（一括設定）" desc="1からすべての項目を作成するのは大変なため、まずは右上の「テンプレート読込 / コピー」ボタンからひな形を読み込むのがおすすめです。">
                    <Alert severity="warning" sx={{ mb: 3 }}><b>ご注意：</b>テンプレートを読み込むと、現在画面に入力されている項目はすべて上書き（リセット）されます。</Alert>
                    
                    <Typography variant="h6" fontWeight="bold" mb={2} mt={4}>パターンA：標準テンプレートから選ぶ</Typography>
                    <Box sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                        <TemplateDialogMock tabIndex={0} />
                    </Box>

                    <Typography variant="h6" fontWeight="bold" mb={2} mt={6}>パターンB：他の利用者からコピーする</Typography>
                    <Box sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                        <TemplateDialogMock tabIndex={1} />
                    </Box>
                </StepBlock>

                {/* 2. 質問の種類 */}
                <StepBlock title="2. 質問の種類（全7種）について" desc="「種類」のメニューから、ヘルパーにどのように入力してほしいかを選択します。種類によって入力画面のデザインが自動的に切り替わります。">
                    
                    <ComparisonBlock 
                        title="セクション見出し" 
                        desc="入力項目ではなく、フォームを見やすくするための「区切り線とタイトル」です。"
                        settingUI={<SettingsCardMock type="section" label="【生活援助・移動支援】" />}
                        inputUI={<Box p={3}><Typography variant="body2" color="text.secondary">↑このように青いバーと太字で区切りが表示されます。</Typography></Box>}
                        mockTitle="【生活援助・移動支援】"
                    />

                    <ComparisonBlock 
                        title="チェック (ON/OFF)" 
                        desc="実施したかどうかをスイッチひとつで記録する形式です。"
                        settingUI={<SettingsCardMock type="checkbox" label="服薬確認" />}
                        inputUI={<RecordCheckboxMock label="服薬確認" detail={false} />}
                        mockTitle="【確認事項】"
                    />

                    <ComparisonBlock 
                        title="複数選択" 
                        desc="提示した選択肢の中から、複数を選べる形式です。"
                        settingUI={<SettingsCardMock type="multicheckbox" label="バイタル測定" options="体温,血圧,脈拍,SpO2" />}
                        inputUI={<RecordMultiCheckboxMock label="バイタル測定" options={['体温', '血圧', '脈拍', 'SpO2']} />}
                        mockTitle="【バイタル】"
                    />

                    <ComparisonBlock 
                        title="1つ選択 (ラジオ)" 
                        desc="提示した選択肢の中から、必ず1つだけを選ばせる形式です。"
                        settingUI={<SettingsCardMock type="select" label="食事の摂取量" options="完食,半分,ほとんど残した" />}
                        inputUI={<RecordRadioMock label="食事の摂取量" options={['完食', '半分', 'ほとんど残した']} />}
                        mockTitle="【食事】"
                    />

                    <ComparisonBlock 
                        title="テキスト入力" 
                        desc="自由に文章を入力させたい場合に使用します。"
                        settingUI={<SettingsCardMock type="text" label="特記事項" />}
                        inputUI={<RecordTextMock label="特記事項" />}
                        mockTitle="【その他】"
                    />

                    <ComparisonBlock 
                        title="数値入力" 
                        desc="数字だけを入力させたい場合に使用します（スマホでは数字キーボードが開きます）。"
                        settingUI={<SettingsCardMock type="number" label="水分量 (ml)" />}
                        inputUI={<RecordNumberMock label="水分量 (ml)" />}
                        mockTitle="【水分補給】"
                    />

                    <ComparisonBlock 
                        title="時間" 
                        desc="特定の時刻を記録させたい場合に使用します。"
                        settingUI={<SettingsCardMock type="time" label="起床時刻" />}
                        inputUI={<RecordTimeMock label="起床時刻" />}
                        mockTitle="【生活状況】"
                    />
                </StepBlock>

                {/* 3. 詳細入力を許可 */}
                <StepBlock title="3. 「詳細入力を許可」機能" desc="チェックボックスや選択肢形式の質問において、「はい/いいえ」を選ぶだけでなく、補足のテキストメモ（詳細）を残せるようにする機能です。現場のヘルパーがチェックを入れた時だけ、自動的に詳細入力欄が表示されます。">
                    <ComparisonBlock 
                        settingUI={<SettingsCardMock type="checkbox" label="排泄介助" hasDetail={true} />}
                        inputUI={<RecordCheckboxMock label="排泄介助" detail={true} />}
                        mockTitle="【各種介助】"
                    />
                </StepBlock>

                {/* 4. 選択肢の入力方法 */}
                <StepBlock title="4. 選択肢の入力方法" desc="種類を「複数選択」または「1つ選択 (ラジオ)」にした場合、「選択肢（カンマ区切り）」の入力欄が表示されます。選択肢同士を 半角カンマ ( , ) または 読点 ( 、 ) で区切って入力すると、自動でボタンが生成されます。">
                    <ComparisonBlock 
                        settingUI={<SettingsCardMock type="multicheckbox" label="清拭・整容介助" hasDetail={true} options="全身, 顔, 上肢, 下肢, 清拭, 入浴介助" />}
                        inputUI={<RecordMultiCheckboxMock label="清拭・整容介助" options={['全身', '顔', '上肢', '下肢', '清拭', '入浴介助']} detail={true} />}
                        mockTitle="【各種介助】"
                    />
                </StepBlock>

                {/* 5. 必須入力の設定 */}
                <StepBlock title="5. 必須入力の設定" desc="「必須」スイッチをONにすると、その項目は入力必須になります。必須にした項目をヘルパーが未入力のまま「送信」ボタンを押すとエラーとなり、送信できなくなります。絶対に記録してほしい項目にはONにしてください。">
                    <ComparisonBlock 
                        settingUI={<SettingsCardMock type="number" label="尿破棄 (ml)" required={true} />}
                        inputUI={<RecordNumberMock label="尿破棄 (ml)" required={true} error={true} />}
                        mockTitle="【各種介助】"
                    />
                </StepBlock>

                {/* 6. 項目の追加・削除・並び替え */}
                <StepBlock title="6. 項目の追加・削除・並び替え" desc="一番下にある点線の「＋ 項目を追加する」ボタンを押すと、新しい空の質問が追加されます。各項目の左下にある赤い「ゴミ箱」アイコンを押すと、その項目を削除できます。項目の左側にある「↑（上へ）」「↓（下へ）」ボタンをクリックすることで、質問の順番を入れ替えることができます。">
                    <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: '#f0f2f5', borderRadius: 3, border: '1px solid #e0e0e0', pointerEvents: 'none', userSelect: 'none' }}>
                        <SettingsCardMock type="text" label="特記事項" />
                        <Button variant="outlined" startIcon={<AddCircleIcon />} size="large" sx={{ border: '2px dashed #ccc', color: '#666', py: 2, width: '100%', bgcolor: '#fafafa', mb: 4 }}>
                            項目を追加する
                        </Button>

                        <Paper elevation={3} sx={{ p: 2, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'center', bgcolor: '#fff' }}>
                            <Stack alignItems="center" spacing={1}>
                                <Typography variant="body2" color="error" fontWeight="bold">※ 設定が完了したら、忘れずに下のボタンを押して保存してください。</Typography>
                                <Button variant="contained" size="large" startIcon={<SaveIcon />} sx={{ minWidth: 300, fontWeight: 'bold', height: 48 }}>設定を保存</Button>
                            </Stack>
                        </Paper>
                    </Box>
                </StepBlock>

            </Container>
        </Box>
    );
}
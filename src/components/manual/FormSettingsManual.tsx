'use client';
import { tokens } from '@/styles/tokens';

import { Fragment, ReactNode } from 'react';
import {
    Box, Typography, Paper, Stack, TextField, MenuItem, IconButton, Card, CardContent,
    Switch, FormControlLabel, Divider, Checkbox, FormGroup, Alert, Button, Tabs, Tab,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText, RadioGroup, Radio,
    Table, TableHead, TableBody, TableRow, TableCell, Chip
} from '@mui/material';

// Icons
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import TitleIcon from '@mui/icons-material/Title';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CommentIcon from '@mui/icons-material/Comment';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import SaveIcon from '@mui/icons-material/Save';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import PersonIcon from '@mui/icons-material/Person';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DescriptionIcon from '@mui/icons-material/Description';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import BusinessIcon from '@mui/icons-material/Business';
import BadgeIcon from '@mui/icons-material/Badge';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PeopleIcon from '@mui/icons-material/People';
import SettingsIcon from '@mui/icons-material/Settings';
import Avatar from '@mui/material/Avatar';

/* =========================================================================
   体験用モックコンポーネント群 ( FormSettings専用 )
========================================================================= */

const NumberBadge = ({ number }: { number: number }) => (
    <Box
        sx={{
            position: 'absolute',
            top: -12,
            left: -12,
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: tokens.status.error.main,
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
        <Box sx={{ display: 'flex', height: 420, border: '1px solid #ddd', borderRadius: 2, overflow: 'hidden', bgcolor: tokens.neutral.gray100, pointerEvents: 'none', userSelect: 'none' }}>
            {/* 1. 左端レール */}
            <Box sx={{ width: 55, bgcolor: tokens.neutral.border, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1.5, gap: 1.5, borderRight: `1px solid ${tokens.neutral.gray300}` }}>
                <Avatar sx={{ bgcolor: tokens.brand.primary, width: 35, height: 35, fontSize: '0.8rem' }}>社</Avatar>
                <Avatar sx={{ bgcolor: '#fff', color: tokens.status.success.main, width: 35, height: 35 }}><AddIcon fontSize="small" /></Avatar>
            </Box>

            {/* 2. サイドバー */}
            <Box sx={{ width: 200, bgcolor: tokens.neutral.surface, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tokens.neutral.gray200}` }}>
                <Box p={1.5} borderBottom={`1px solid ${tokens.neutral.gray200}`}><Typography variant="caption" fontWeight="bold" sx={{ fontSize: '0.75rem' }}>一般社団法人ケアワーク</Typography></Box>
                <Box flexGrow={1} py={0.5}>
                    <Typography variant="caption" sx={{ px: 2, py: 0.5, color: '#666', fontWeight: 'bold', fontSize: '0.65rem' }}>記録</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton sx={{ py: 0.4 }}><ListItemIcon sx={{ minWidth: 28 }}><EditNoteIcon fontSize="small" /></ListItemIcon><ListItemText primary="記録を作成" primaryTypographyProps={{ fontSize: '0.75rem' }} /></ListItemButton></ListItem>
                        <ListItem disablePadding><ListItemButton sx={{ py: 0.4 }}><ListItemIcon sx={{ minWidth: 28 }}><HistoryIcon fontSize="small" /></ListItemIcon><ListItemText primary="自分の履歴" primaryTypographyProps={{ fontSize: '0.75rem' }} /></ListItemButton></ListItem>
                    </List>

                    <Typography variant="caption" sx={{ px: 2, py: 0.5, color: '#666', fontWeight: 'bold', display: 'block', mt: 0.5, fontSize: '0.65rem' }}>管理</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton sx={{ py: 0.4 }}><ListItemIcon sx={{ minWidth: 28 }}><BusinessIcon fontSize="small" /></ListItemIcon><ListItemText primary="事業所設定" primaryTypographyProps={{ fontSize: '0.75rem' }} /></ListItemButton></ListItem>

                        {/* ★ここをクリックさせる */}
                        <Box sx={{ position: 'relative', mx: 1, mt: 0.2 }}>
                            <NumberBadge number={1} />
                            <Box sx={{ border: `3px solid ${tokens.status.error.main}`, borderRadius: 1, bgcolor: 'rgba(255, 23, 68, 0.05)' }}>
                                <ListItemButton selected sx={{ borderRadius: 1, pl: 1, py: 0.5 }}>
                                    <ListItemIcon sx={{ minWidth: 28 }}><PeopleIcon fontSize="small" color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold" color="primary.main" fontSize="0.75rem">利用者管理</Typography>} />
                                </ListItemButton>
                            </Box>
                        </Box>
                    </List>
                </Box>
            </Box>

            {/* 3. メインエリア */}
            <Box sx={{ flexGrow: 1, bgcolor: '#fff', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ height: 48, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', px: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <PeopleIcon color="action" fontSize="small" />
                        <Typography variant="subtitle2" fontWeight="bold">利用者管理</Typography>
                    </Stack>
                </Box>

                <Box sx={{ p: 2, flexGrow: 1, bgcolor: tokens.neutral.gray75 }}>
                    <Box display="flex" justifyContent="flex-end" mb={1.5}>
                        <Button variant="contained" size="small" startIcon={<AddIcon />} sx={{ fontSize: '0.7rem' }}>新規登録</Button>
                    </Box>

                    <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden' }}>
                        <Table size="small">
                            <TableHead sx={{ bgcolor: tokens.neutral.gray100 }}>
                                <TableRow>
                                    <TableCell sx={{ fontSize: '0.7rem', py: 0.5 }}>利用者氏名</TableCell>
                                    <TableCell align="right" sx={{ fontSize: '0.7rem', py: 0.5 }}>操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow hover>
                                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>鈴木 一郎 様</TableCell>
                                    <TableCell align="right" sx={{ py: 0.5 }}>
                                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                                            <IconButton size="small"><EditIcon fontSize="small" /></IconButton>

                                            {/* ★ここをクリックさせる */}
                                            <Box sx={{ position: 'relative' }}>
                                                <NumberBadge number={2} />
                                                <Box sx={{ border: `3px solid ${tokens.status.error.main}`, borderRadius: 1, display: 'inline-block' }}>
                                                    <IconButton size="small" color="primary" sx={{ bgcolor: tokens.blueTint[100], p: 0.3 }}>
                                                        <SettingsIcon fontSize="small" />
                                                    </IconButton>
                                                </Box>
                                            </Box>
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
};

const SettingsCardMock = ({
    type, label, required, hasDetail, options
}: {
    type: 'section' | 'checkbox' | 'multicheckbox' | 'text' | 'number' | 'select' | 'time',
    label: string, required?: boolean, hasDetail?: boolean, options?: string
}) => (
    <Card sx={{ overflow: 'visible', borderLeft: type === 'section' ? `6px solid ${tokens.brand.primary}` : 'none', bgcolor: type === 'section' ? tokens.blueTint[100] : 'white', mb: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', borderRadius: 2 }}>
        <CardContent sx={{ p: '12px !important' }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                <Stack direction="column" spacing={0.5}>
                    <IconButton size="small"><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small"><ArrowDownwardIcon fontSize="small" /></IconButton>
                    <IconButton color="error" size="small" sx={{ mt: 1 }}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
                <Box sx={{ flexGrow: 1, width: '100%' }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} mb={1}>
                        <TextField select label="種類" size="small" value={type} sx={{ minWidth: 140 }} InputProps={{ startAdornment: type === 'section' ? <TitleIcon sx={{ mr: 1, color: 'primary.main' }} /> : null }}>
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
                        <TextField label={type === 'section' ? "セクション名" : "質問内容"} size="small" fullWidth value={label} sx={{ '& .MuiInputBase-input': { fontWeight: type === 'section' ? 'bold' : 'normal', fontSize: '0.95rem' } }} />
                        {type !== 'section' && <FormControlLabel control={<Switch size="small" checked={required || false} />} label={<Typography fontSize="0.75rem">必須</Typography>} sx={{ minWidth: 60 }} />}
                    </Stack>
                    {(type === 'checkbox' || type === 'multicheckbox' || type === 'select') && (
                        <FormControlLabel control={<Switch size="small" color="secondary" checked={hasDetail || false} />} label={<Box display="flex" alignItems="center" gap={0.5} sx={{ fontSize: '0.75rem' }}><CommentIcon fontSize="small" color="action" />詳細入力を許可</Box>} sx={{ mb: 1, ml: 0.5 }} />
                    )}
                    {(type === 'select' || type === 'multicheckbox') && (
                        <TextField label="選択肢（カンマ区切り）" size="small" fullWidth value={options || ''} InputProps={{ startAdornment: <CheckBoxIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 16 }} /> }} />
                    )}
                </Box>
            </Stack>
        </CardContent>
    </Card>
);

const TemplateDialogMock = ({ tabIndex }: { tabIndex: number }) => (
    <Box sx={{ position: 'relative', p: { xs: 1.5, md: 3 }, bgcolor: 'rgba(0,0,0,0.03)', borderRadius: 2, display: 'flex', justifyContent: 'center', my: 2 }}>
        <Paper elevation={3} sx={{ width: '100%', maxWidth: 500, borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
            <Box sx={{ p: 1.5, px: 2, borderBottom: '1px solid #eee' }}><Typography variant="subtitle2" fontWeight="bold">記録項目の設定を読み込む</Typography></Box>
            <Tabs value={tabIndex} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: tokens.neutral.bg }}>
                <Tab label="標準テンプレート" />
                <Tab label="他の利用者からコピー" />
            </Tabs>
            <Box sx={{ p: 2, minHeight: 180 }}>
                {tabIndex === 0 && (
                    <Stack spacing={1.5}>
                        <Typography variant="caption" color="text.secondary">用途に合わせて標準的な記録項目セットを一括反映します。反映後、自由に変更できます。</Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }} dense>
                            <ListItem disablePadding><ListItemButton sx={{ py: 0.5 }}><ListItemText primary={<Typography fontSize="0.8rem" fontWeight="bold">標準セット（重度訪問・総合）</Typography>} secondary={<Typography fontSize="0.7rem" color="text.secondary">身体介護から生活援助まで網羅したフルセット</Typography>} /></ListItemButton></ListItem>
                            <Divider />
                            <ListItem disablePadding><ListItemButton sx={{ py: 0.5 }}><ListItemText primary={<Typography fontSize="0.8rem" fontWeight="bold">身体介護中心</Typography>} secondary={<Typography fontSize="0.7rem" color="text.secondary">入浴・排泄・食事などの身体ケアに特化</Typography>} /></ListItemButton></ListItem>
                        </List>
                    </Stack>
                )}
                {tabIndex === 1 && (
                    <Stack spacing={1.5}>
                        <Typography variant="caption" color="text.secondary">同じ事業所内の他の利用者の設定をコピーします。</Typography>
                        <List sx={{ bgcolor: 'background.paper', border: '1px solid #eee', borderRadius: 2, p: 0 }} dense>
                            <ListItem disablePadding><ListItemButton sx={{ py: 0.5 }}><ListItemText primary={<Typography fontSize="0.8rem">鈴木 一郎</Typography>} /></ListItemButton></ListItem>
                            <Divider />
                            <ListItem disablePadding><ListItemButton sx={{ py: 0.5 }}><ListItemText primary={<Typography fontSize="0.8rem">佐藤 花子</Typography>} /></ListItemButton></ListItem>
                        </List>
                    </Stack>
                )}
            </Box>
        </Paper>
    </Box>
);

const RecordUIMock = ({ title, children }: { title?: string, children: ReactNode }) => (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', maxWidth: 500, margin: '0 auto', width: '100%' }}>
        {title && (
            <Box sx={{ bgcolor: tokens.neutral.bg, px: 2.5, py: 1.2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
                <Box sx={{ width: 5, height: 22, bgcolor: 'primary.main', borderRadius: 1, mr: 1.5, flexShrink: 0 }} />
                <Typography variant="subtitle2" color="text.primary" fontWeight="bold">{title}</Typography>
            </Box>
        )}
        <Stack divider={<Divider />}>{children}</Stack>
    </Paper>
);

const RecordCheckboxMock = ({ label, detail }: { label: string, detail?: boolean }) => (
    <Box sx={{ p: 2.5, bgcolor: 'transparent' }}>
        <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                <Typography variant="subtitle2" fontWeight={detail ? "bold" : "normal"} color={detail ? "primary.main" : "text.primary"}>{label}</Typography>
                <Switch checked={detail} size="small" />
            </Box>
            {detail && <TextField placeholder="詳細... (例: 軟便少量あり)" fullWidth size="small" />}
        </Box>
    </Box>
);

const RecordMultiCheckboxMock = ({ label, required, options }: { label: string, required?: boolean, options: string[] }) => (
    <Box sx={{ p: 2.5 }}>
        <Typography variant="caption" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <FormGroup row sx={{ gap: 0.5 }}>
            {options.map((opt, i) => {
                const checked = i === 0 || i === 2;
                return (
                    <FormControlLabel key={opt} control={<Checkbox size="small" checked={checked} />} label={<Typography variant="body2" fontSize="0.75rem" fontWeight={checked ? 'bold' : 'normal'}>{opt}</Typography>} sx={{ mr: 1, mb: 1, border: '1px solid', borderRadius: 1.5, px: 1, py: 0.2, mx: 0, bgcolor: checked ? tokens.blueTint[100] : 'transparent', borderColor: checked ? 'primary.main' : 'divider' }} />
                );
            })}
        </FormGroup>
    </Box>
);

const RecordRadioMock = ({ label, required, options }: { label: string, required?: boolean, options: string[] }) => (
    <Box sx={{ p: 2.5 }}>
        <Typography variant="caption" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <RadioGroup row value={options[0]}>
            {options.map((opt) => (
                <FormControlLabel key={opt} value={opt} control={<Radio size="small" />} label={<Typography variant="body2" fontSize="0.75rem" fontWeight={opt === options[0] ? 'bold' : 'normal'}>{opt}</Typography>} sx={{ mr: 2 }} />
            ))}
        </RadioGroup>
    </Box>
);

const RecordTextMock = ({ label, required }: { label: string, required?: boolean }) => (
    <Box sx={{ p: 2.5, bgcolor: 'transparent' }}>
        <Typography variant="caption" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" multiline minRows={2.5} size="small" placeholder={`${label}を入力`} />
    </Box>
);

const RecordNumberMock = ({ label, required, error }: { label: string, required?: boolean, error?: boolean }) => (
    <Box sx={{ p: 2.5, bgcolor: error ? tokens.status.error.bg : 'transparent' }}>
        <Typography variant="caption" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" type="number" size="small" placeholder={`${label}を入力`} error={error} helperText={error ? "必須項目です" : ""} />
    </Box>
);

const RecordTimeMock = ({ label, required }: { label: string, required?: boolean }) => (
    <Box sx={{ p: 2.5, bgcolor: 'transparent' }}>
        <Typography variant="caption" fontWeight="bold" gutterBottom sx={{ mb: 1, display: 'block' }}>{label} {required && <Typography component="span" color="error">*</Typography>}</Typography>
        <TextField fullWidth variant="outlined" type="time" size="small" InputLabelProps={{ shrink: true }} defaultValue="12:00" />
    </Box>
);

const StepBlock = ({ title, desc, children }: { title: ReactNode, desc?: ReactNode, children: ReactNode }) => (
    <Box mb={8}>
        <Typography variant="h5" fontWeight="bold" color="primary.main" gutterBottom sx={{ borderBottom: '3px solid', borderColor: 'primary.main', pb: 1, display: 'inline-block' }}>{title}</Typography>
        {desc && <Typography variant="body1" paragraph sx={{ mt: 1.5, mb: 2.5, lineHeight: 1.8 }}>{desc}</Typography>}
        <Box mt={2.5}>{children}</Box>
    </Box>
);

const ComparisonBlock = ({
    title, desc, settingUI, inputUI, mockTitle = "【各種介助】"
}: {
    title?: string, desc?: string, settingUI: ReactNode, inputUI: ReactNode, mockTitle?: string | null
}) => (
    <Box mb={5}>
        {title && <Typography variant="h6" fontWeight="bold" color="primary.main" gutterBottom sx={{ fontSize: '1.05rem' }}>■ {title}</Typography>}
        {desc && <Typography variant="body2" color="text.secondary" mb={2} sx={{ fontSize: '0.85rem' }}>{desc}</Typography>}
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="stretch">
            {/* 設定UI */}
            <Box flex={1} sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                <Box p={2} bgcolor={tokens.blueTint.slate50} borderRadius={3} border={`1px solid ${tokens.blueTint.slate200}`} height="100%" display="flex" flexDirection="column" justifyContent="center">
                    {settingUI}
                </Box>
            </Box>
            {/* 入力UI */}
            <Box flex={1} sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                <Box p={2} bgcolor={tokens.blueTint.slate50} borderRadius={3} border={`1px solid ${tokens.blueTint.slate200}`} height="100%" display="flex" flexDirection="column" justifyContent="center">
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
export default function FormSettingsManual() {
    return (
        <Box sx={{ bgcolor: '#fff', pb: 10 }}>
            <Box sx={{ mb: 5, borderBottom: '2px solid #eee', pb: 3 }}>
                <Chip label="管理者向け" color="primary" size="small" sx={{ mb: 1, fontWeight: 'bold' }} />
                <Typography variant="h4" fontWeight="bold" color="text.primary">記録フォームの設定・カスタマイズ</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    利用者ごとに最適な記録項目（フォーム）をカスタマイズする方法と、実際の現場のヘルパーの入力画面の見え方を解説します。
                </Typography>
            </Box>

            {/* 本文エリア */}
            <Box>
                {/* 0. フォーム設定画面の開き方 */}
                <StepBlock title="0. フォーム設定画面の開き方" desc="アプリのメニューから、利用者ごとのフォーム設定画面を開く手順です。">
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight="bold" mb={2} sx={{ fontSize: '0.9rem' }}>
                            <span style={{ color: tokens.status.error.main, fontWeight: 'bold' }}>① サイドメニュー</span> から「利用者管理」を選択し、
                            <span style={{ color: tokens.status.error.main, fontWeight: 'bold', marginLeft: 8 }}>② 利用者一覧</span> の右側にある「詳細設定（青い歯車）」アイコンをクリックしてください。
                        </Typography>
                    </Box>
                    <NavigationScreenMock />
                </StepBlock>

                {/* 1. テンプレートの読み込み */}
                <StepBlock title="1. テンプレートの読み込み（一括設定）" desc="1からすべての項目を作成するのは大変なため、まずは右上の「テンプレート読込 / コピー」ボタンからひな形を読み込むのがおすすめです。">
                    <Alert severity="warning" sx={{ mb: 3, fontSize: '0.85rem' }}><b>ご注意：</b>テンプレートを読み込むと、現在画面に入力されている項目はすべて上書き（リセット）されます。</Alert>

                    <Typography variant="subtitle2" fontWeight="bold" mb={1} mt={4}>パターンA：標準テンプレートから選ぶ</Typography>
                    <Box sx={{ pointerEvents: 'none', userSelect: 'none' }}>
                        <TemplateDialogMock tabIndex={0} />
                    </Box>

                    <Typography variant="subtitle2" fontWeight="bold" mb={1} mt={5}>パターンB：他の利用者からコピーする</Typography>
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
                        inputUI={<RecordMultiCheckboxMock label="清拭・整容介助" options={['全身', '顔', '上肢', '下肢', '清拭', '入浴介助']} />}
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
                    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: tokens.neutral.gray50, borderRadius: 3, border: `1px dashed ${tokens.blueTint.slate200}`, pointerEvents: 'none', userSelect: 'none' }}>
                        <SettingsCardMock type="text" label="特記事項" />
                        <Button variant="outlined" size="large" sx={{ border: '2px dashed #ccc', color: '#666', py: 1.5, width: '100%', bgcolor: '#fff', mb: 3 }}>
                            項目を追加する
                        </Button>

                        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, bgcolor: tokens.blueTint.slate50, border: `1px solid ${tokens.blueTint.slate200}` }}>
                            <Stack alignItems="center" spacing={1}>
                                <Typography variant="body2" color="error" fontWeight="bold" sx={{ fontSize: '0.85rem' }}>※ 設定が完了したら、忘れずに下のボタンを押して保存してください。</Typography>
                                <Button variant="contained" size="large" sx={{ minWidth: 250, fontWeight: 'bold', height: 42, boxShadow: 'none' }}>設定を保存</Button>
                            </Stack>
                        </Paper>
                    </Box>
                </StepBlock>
            </Box>
        </Box>
    );
}
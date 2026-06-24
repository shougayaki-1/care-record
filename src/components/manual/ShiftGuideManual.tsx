'use client';
import { tokens } from '@/styles/tokens';

import React, { ReactNode } from 'react';
import {
    Box, Typography, Paper, Stack, TextField, Card, CardContent,
    Switch, FormControlLabel, Checkbox, FormGroup, Alert, Button, Chip,
    Table, TableHead, TableBody, TableRow, TableCell, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import GridOnIcon from '@mui/icons-material/GridOn';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PeopleIcon from '@mui/icons-material/People';
import BusinessIcon from '@mui/icons-material/Business';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import Avatar from '@mui/material/Avatar';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

/* =========================================================================
   体験用モックコンポーネント群 ( ShiftGuide専用 )
========================================================================= */

const NumberBadge = ({ number }: { number: number }) => (
    <Box
        sx={{
            position: 'absolute',
            top: -12,
            left: -12,
            width: 26,
            height: 26,
            borderRadius: '50%',
            bgcolor: tokens.status.error.main,
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            zIndex: 20,
            border: '2px solid white'
        }}
    >
        {number}
    </Box>
);

const ShiftManageScreenMock = () => {
    return (
        <Box sx={{ display: 'flex', height: 480, border: '1px solid #ddd', borderRadius: 3, overflow: 'hidden', bgcolor: tokens.neutral.surfaceSoft, pointerEvents: 'none', userSelect: 'none' }}>
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
                    </List>

                    <Typography variant="caption" sx={{ px: 2, py: 0.5, color: '#666', fontWeight: 'bold', display: 'block', mt: 1, fontSize: '0.65rem' }}>シフト</Typography>
                    <List dense disablePadding>
                        <Box sx={{ position: 'relative', mx: 0.8 }}>
                            <NumberBadge number={1} />
                            <Box sx={{ border: `3px solid ${tokens.status.error.main}`, borderRadius: 1, bgcolor: 'rgba(255, 23, 68, 0.05)' }}>
                                <ListItemButton selected sx={{ borderRadius: 1, pl: 1, py: 0.4 }}>
                                    <ListItemIcon sx={{ minWidth: 28 }}><CalendarMonthIcon fontSize="small" color="primary" /></ListItemIcon>
                                    <ListItemText primary={<Typography fontWeight="bold" color="primary.main" fontSize="0.75rem">シフト管理</Typography>} />
                                </ListItemButton>
                            </Box>
                        </Box>
                    </List>

                    <Typography variant="caption" sx={{ px: 2, py: 0.5, color: '#666', fontWeight: 'bold', display: 'block', mt: 1, fontSize: '0.65rem' }}>管理</Typography>
                    <List dense disablePadding>
                        <ListItem disablePadding><ListItemButton sx={{ py: 0.4 }}><ListItemIcon sx={{ minWidth: 28 }}><PeopleIcon fontSize="small" /></ListItemIcon><ListItemText primary="利用者管理" primaryTypographyProps={{ fontSize: '0.75rem' }} /></ListItemButton></ListItem>
                    </List>
                </Box>
            </Box>

            {/* 3. メインエリア */}
            <Box sx={{ flexGrow: 1, bgcolor: '#fff', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ px: 2, pt: 1.5, borderBottom: '1px solid #eee', bgcolor: 'background.paper' }}>
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>シフト管理・カレンダー</Typography>

                    <Box sx={{ display: 'flex', borderBottom: '2px solid #ddd', pb: '1px', gap: 2, position: 'relative' }}>
                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'primary.main', borderBottom: `2px solid ${tokens.brand.primary}`, pb: 1 }}>基本パターン(ひな形)</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: '#666', pb: 1 }}>全体カレンダー</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: '#666', pb: 1 }}>自分のシフト</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: '#666', pb: 1 }}>スタッフ別</Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: '#666', pb: 1 }}>利用者別</Typography>
                    </Box>
                </Box>

                <Box sx={{ p: 2, bgcolor: tokens.neutral.gray75, flexGrow: 1 }}>
                    <Box sx={{ position: 'relative', p: 1.5, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 2, bgcolor: tokens.blueTint[50], border: `1px solid ${tokens.blueTint[300]}` }}>
                        <NumberBadge number={2} />
                        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>ひな形から指定月のカレンダーへシフトを一括展開します。</Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <TextField type="month" size="small" defaultValue="2025-06" sx={{ bgcolor: 'white', '& .MuiInputBase-input': { fontSize: '0.7rem', py: 0.5 } }} />
                            <Box sx={{ border: `3px solid ${tokens.status.error.main}`, borderRadius: 1 }}>
                                <Button variant="contained" color="secondary" size="small" startIcon={<PlayArrowIcon fontSize="small" />} sx={{ fontSize: '0.7rem', py: 0.2, boxShadow: 'none' }}>一括自動展開</Button>
                            </Box>
                        </Stack>
                    </Box>

                    <Paper variant="outlined" sx={{ borderRadius: 2 }}>
                        <Table size="small">
                            <TableHead sx={{ bgcolor: tokens.neutral.gray50 }}>
                                <TableRow>
                                    <TableCell sx={{ fontSize: '0.7rem', py: 0.5 }}>対象の利用者</TableCell>
                                    <TableCell sx={{ fontSize: '0.7rem', py: 0.5 }}>サイクル</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                <TableRow>
                                    <TableCell sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}>山田 太郎 様</TableCell>
                                    <TableCell sx={{ fontSize: '0.7rem' }}><Chip label="毎週日曜日" size="small" variant="outlined" color="primary" sx={{ height: 16, fontSize: '0.6rem' }} /></TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </Paper>
                </Box>
            </Box>
        </Box>
    );
};

const PatternCardMock = () => (
    <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'white', border: '1px solid #ddd' }}>
        <Box sx={{ p: 1.5, borderBottom: '1px solid #eee', bgcolor: tokens.neutral.gray60, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" fontWeight="bold" fontSize="0.8rem">【ひな形】山田 太郎 様 (毎週日曜・夜勤)</Typography>
            <Chip label="毎週日曜日" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
        </Box>
        <CardContent sx={{ p: 1.5, py: 1 }}>
            <Stack spacing={1}>
                <Box display="flex" justifyContent="space-between"><Typography variant="caption" color="text.secondary">時間帯:</Typography><Typography variant="caption" fontWeight="bold">20:00 〜 翌09:00 (泊まり)</Typography></Box>
                <Box display="flex" justifyContent="space-between"><Typography variant="caption" color="text.secondary">デフォルト担当:</Typography><Typography variant="caption">佐藤 花子</Typography></Box>
            </Stack>
        </CardContent>
    </Card>
);

const PreviewDialogMock = () => (
    <Paper elevation={3} sx={{ width: '100%', maxWidth: 450, borderRadius: 2, overflow: 'hidden', bgcolor: '#fff', border: '1px solid #ccc', mx: 'auto' }}>
        <Box sx={{ p: 1.5, px: 2, bgcolor: tokens.neutral.gray100 }}><Typography variant="subtitle2" fontWeight="bold">2025年6月 シフト展開の確認</Typography></Box>
        <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 1.5, py: 0, fontSize: '0.75rem' }}>既存の未編集シフトは自動更新され、手動調整済みのシフトは保護されます。</Alert>
            <Box p={1.5} bgcolor={tokens.blueTint[50]} borderRadius={2} border={`1px solid ${tokens.blueTint[300]}`} mb={1.5}>
                <Typography variant="caption" fontWeight="bold" color="primary">展開予定の総シフト数： 42 件</Typography>
            </Box>
            <Typography variant="caption" fontWeight="bold" display="block" mb={0.5}>展開予定内訳:</Typography>
            <Stack spacing={0.5} sx={{ p: 1, border: '1px solid #eee', borderRadius: 1.5, bgcolor: tokens.neutral.gray70, maxHeight: 80, overflowY: 'auto' }}>
                <Box display="flex" justifyContent="space-between"><Typography variant="caption" fontSize="0.7rem">山田 太郎 様 (佐藤 花子)</Typography><Typography variant="caption" fontSize="0.7rem" color="text.secondary">8件 (泊まり分割)</Typography></Box>
            </Stack>
        </Box>
    </Paper>
);

const ShiftFormModalMock = () => (
    <Paper elevation={3} sx={{ width: '100%', maxWidth: 450, borderRadius: 2, overflow: 'hidden', bgcolor: '#fff', border: '1px solid #ccc', mx: 'auto' }}>
        <Box sx={{ p: 1.5, px: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee' }}>
            <Typography variant="subtitle2" fontWeight="bold">単発シフトの編集・詳細</Typography>
            <IconButton size="small" color="error"><DeleteIcon fontSize="small" /></IconButton>
        </Box>
        <Box sx={{ p: 2 }}>
            <Stack spacing={2}>
                <Box p={1.5} bgcolor={tokens.status.error.bgAlt} borderRadius={1.5} border={`1px solid ${tokens.status.error.border}`}>
                    <Typography color="error" fontWeight="bold" variant="caption" display="block">⚠ この予定はキャンセル（お休み）に設定されています</Typography>
                    <Typography variant="caption" color="text.secondary">キャンセル理由: ご本人様が入院されたため</Typography>
                </Box>
                <TextField label="利用者" value="山田 太郎 様" size="small" fullWidth />
            </Stack>
        </Box>
    </Paper>
);

const CalendarGridMock = () => (
    <Box sx={{ border: '1px solid #ddd', borderRadius: 2, overflow: 'hidden', bgcolor: 'white', maxWidth: 500, width: '100%', mx: 'auto' }}>
        <Table size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
                <TableRow sx={{ bgcolor: tokens.neutral.gray100, height: 32 }}>
                    <TableCell align="center" sx={{ fontWeight: 'bold', fontSize: '0.85rem', borderRight: '1px solid #ddd', p: 0.5 }}>日</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold', fontSize: '0.85rem', p: 0.5 }}>月</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                <TableRow sx={{ height: 120 }}>
                    <TableCell valign="top" sx={{ borderRight: '1px solid #ddd', p: 0.5, position: 'relative' }}>
                        <Typography align="right" variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', display: 'block' }}>26</Typography>
                        <Box sx={{ mt: 0.5, p: 0.8, bgcolor: tokens.blueTint[150], borderLeft: `3px solid ${tokens.brand.primary}`, borderRadius: '4px' }}>
                            <Typography variant="caption" color="primary" fontWeight="bold" sx={{ fontSize: '0.7rem', display: 'block' }}>20:00 - 09:00</Typography>
                            <Typography variant="caption" fontWeight="bold" color="text.primary" display="block">山田 太郎 様</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>(佐藤 花子)</Typography>
                        </Box>
                    </TableCell>
                    <TableCell valign="top" sx={{ p: 0.5 }}>
                        <Typography align="right" variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', display: 'block' }}>27</Typography>
                        <Box sx={{ mt: 0.5, p: 0.8, bgcolor: tokens.blueTint[150], borderLeft: `3px solid ${tokens.brand.primary}`, borderRadius: '4px' }}>
                            <Typography variant="caption" color="primary" fontWeight="bold" sx={{ fontSize: '0.7rem', display: 'block' }}>08:00 - 17:00</Typography>
                            <Typography variant="caption" fontWeight="bold" color="text.primary" display="block">鈴木 一郎 様</Typography>
                        </Box>
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </Box>
);

const PdfCalendarSplitMock = () => (
    <Box sx={{ border: `2px solid ${tokens.brand.primary}`, borderRadius: 2, p: 1.5, bgcolor: tokens.neutral.gray50, maxWidth: 500, width: '100%', mx: 'auto' }}>
        <Box display="flex" justifyContent="space-between" mb={0.5} borderBottom="1px solid #ccc" pb={0.5}>
            <Typography variant="caption" color="primary" fontWeight="bold" fontSize="0.7rem">カレンダー型PDF出力レイアウト（日またぎ自動分割表示）</Typography>
        </Box>
        <Table size="small" sx={{ tableLayout: 'fixed', border: '1px solid #ccc' }}>
            <TableHead>
                <TableRow sx={{ bgcolor: tokens.blueTint[50], height: 20 }}>
                    <TableCell align="center" sx={{ fontSize: 8, p: 0.3, borderRight: '1px solid #ccc' }}>26 (日)</TableCell>
                    <TableCell align="center" sx={{ fontSize: 8, p: 0.3 }}>27 (月)</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                <TableRow sx={{ height: 60 }}>
                    <TableCell valign="top" sx={{ borderRight: '1px solid #ccc', p: 0.3 }}>
                        <Box sx={{ bgcolor: tokens.blueTint[150], p: 0.4, borderRadius: 0.5 }}>
                            <Typography sx={{ fontSize: 7, fontWeight: 'bold', color: tokens.brand.primary }}>20:00〜00:00</Typography>
                            <Typography sx={{ fontSize: 7, fontWeight: 'bold' }}>山田 太郎 様</Typography>
                        </Box>
                    </TableCell>
                    <TableCell valign="top" sx={{ p: 0.3 }}>
                        <Box sx={{ bgcolor: tokens.blueTint[150], p: 0.4, borderRadius: 0.5, borderLeft: `2px solid ${tokens.status.warning.main}` }}>
                            <Typography sx={{ fontSize: 7, fontWeight: 'bold', color: tokens.status.warning.main }}>00:00〜09:00</Typography>
                            <Typography sx={{ fontSize: 7, fontWeight: 'bold' }}>山田 太郎 様</Typography>
                        </Box>
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </Box>
);

const StepBlock = ({ title, desc, children }: { title: ReactNode, desc?: ReactNode, children: ReactNode }) => (
    <Box mb={8}>
        <Typography variant="h5" fontWeight="bold" color="primary.main" gutterBottom sx={{ borderBottom: '3px solid', borderColor: 'primary.main', pb: 1, display: 'inline-block' }}>{title}</Typography>
        {desc && <Typography variant="body1" paragraph sx={{ mt: 1.5, mb: 2.5, lineHeight: 1.8 }}>{desc}</Typography>}
        <Box mt={2.5}>{children}</Box>
    </Box>
);

export default function ShiftGuideManual() {
    return (
        <Box>
            <Box sx={{ mb: 5, borderBottom: '2px solid #eee', pb: 3 }}>
                <Chip label="管理者・一般スタッフ共通" color="secondary" size="small" sx={{ mb: 1, fontWeight: 'bold' }} />
                <Typography variant="h4" fontWeight="bold" color="text.primary">シフト管理・Web閲覧・PDF出力ガイド</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    繰り返しのひな形登録、カレンダー自動展開プレビュー、および日またぎ対応カレンダーPDF出力について解説します。
                </Typography>
            </Box>

            {/* 0. シフト管理カレンダーの画面構成 */}
            <StepBlock
                title="0. シフト管理の画面構成と全体の流れ"
                desc="新しく統合された「シフト管理」画面の全体像と操作動線です。"
            >
                <Typography variant="body2" color="text.secondary" mb={2}>
                    目次メニューから <span style={{ color: tokens.status.error.main, fontWeight: 'bold' }}>① 「シフト管理」</span> を開くと、統合カレンダー画面が立ち上がります。<br />
                    管理者が今月分のひな形を一括反映させたい場合は、<span style={{ color: tokens.status.error.main, fontWeight: 'bold' }}>② コントロールパネルの「一括自動展開」</span> ボタンをクリックして、展開プレビューを実行します。
                </Typography>
                <Box sx={{ p: { xs: 1.5, md: 3 }, bgcolor: tokens.blueTint[100], borderRadius: 3, border: `1px solid ${tokens.neutral.gray300}`, pointerEvents: 'none', userSelect: 'none' }}>
                    <ShiftManageScreenMock />
                </Box>
            </StepBlock>

            {/* 1. シフトひな形（基本パターン）の作成 */}
            <StepBlock
                title="1. 【管理者】シフトひな形（基本パターン）の作成"
                desc="毎月のシフト作成を迅速化するために、まずは利用者の「毎週の基本リズム（ひな形パターン）」を登録します。"
            >
                <Typography variant="body2" color="text.secondary" mb={3}>
                    「ひな形を追加」ボタンから、曜日・時間・デフォルトの担当ヘルパーを設定します。<br />
                    2週間に1回（隔週）などの特殊なスケジュールロジック（INTERVAL）も指定可能です。
                </Typography>
                <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: tokens.neutral.surfaceAlt, borderRadius: 3, border: `1px solid ${tokens.neutral.gray200}`, pointerEvents: 'none' }}>
                    <PatternCardMock />
                </Box>
            </StepBlock>

            {/* 2. 管理者向け：カレンダーへの月次一括展開と安全プレビュー */}
            <StepBlock
                title="2. 【管理者】カレンダーへの一括自動展開（プレビュー機能）"
                desc="登録されたひな形データから、指定した対象月へ、一気にカレンダーシフトを実体化させます。"
            >
                <Typography variant="body2" color="text.secondary" mb={3}>
                    展開ボタンを押すと、すぐにDBに保存されるのではなく「展開プレビュー確認ダイアログ」が立ち上がります。<br />
                    展開件数の内訳を事前に確認することで、誤った月への上書きミスを未然に防止します。
                </Typography>
                <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: tokens.neutral.surfaceAlt, borderRadius: 3, border: `1px solid ${tokens.neutral.gray200}`, pointerEvents: 'none' }}>
                    <PreviewDialogMock />
                </Box>
            </StepBlock>

            {/* 3. 管理者向け：単発シフトの追加・微調整・キャンセルの管理 */}
            <StepBlock
                title="3. 【管理者】単発シフトの調整・キャンセル（お休み）管理"
                desc="展開された予定の微調整（担当ヘルパーの変更や時間の微調整）や、急なキャンセル発生時の管理手順です。"
            >
                <Typography variant="body2" color="text.secondary" mb={3}>
                    間違えて作成したシフトはヘッダー右上の「ゴミ箱」から完全削除できます。<br />
                    急な入院や都合によるお休みの場合は、履歴を残すために「お休みにする」ボタンを使用し、理由を添えてステータスをキャンセル（休）に変更します。
                </Typography>
                <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: tokens.neutral.surfaceAlt, borderRadius: 3, border: `1px solid ${tokens.neutral.gray200}`, pointerEvents: 'none' }}>
                    <ShiftFormModalMock />
                </Box>
            </StepBlock>

            {/* 4. 一般・管理者共通：Webでの快適なシフト閲覧 */}
            <StepBlock
                title="4. 【全ユーザー】Webカレンダー・リストでのシフト閲覧"
                desc="現場ヘルパーおよび管理者は、統合カレンダー画面から直観的なカレンダービューでスケジュールを一覧確認できます。"
            >
                <Typography variant="body2" color="text.secondary" mb={3}>
                    スマホやPC of の画面サイズに合わせてレスポンシブに調整され、表示形式（月間・週間・リスト）をタブやボタンで瞬時に切り替えられます。<br />
                    予定ブロックをクリックすることで、そのまま「サービス提供記録票」の入力画面へとダイレクトに遷移できます。
                </Typography>
                <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: tokens.neutral.surfaceAlt, borderRadius: 3, border: `1px solid ${tokens.neutral.gray200}`, pointerEvents: 'none' }}>
                    <CalendarGridMock />
                </Box>
            </StepBlock>

            {/* 5. 一般・管理者共通：高度なシフトPDF出力（日またぎ対応） */}
            <StepBlock
                title="5. 【全ユーザー】日またぎシフトに対応した高度なPDF出力"
                desc="夜勤や宿直など「日を跨ぐシフト」が入っている場合、翌日のカレンダーセルにも自動的に予定が分割マッピングされて印刷・エクスポートされます。"
            >
                <Typography variant="body2" color="text.secondary" mb={3}>
                    「表示中の形式でPDF出力」ボタンを押すと、紙面での夜勤帯の確認・把握漏れを防ぐために、開始日の『20:00〜00:00』と翌日の『00:00〜09:00』の両方に予定が表示されるカレンダーPDFが自動生成されます。<br />
                    また、管理者側ではスタッフ全員の横断シフトを一目で把握できる「全体マトリックスPDF」の印刷出力も可能です。
                </Typography>
                <Box sx={{ p: { xs: 2, md: 4 }, bgcolor: tokens.neutral.surfaceAlt, borderRadius: 3, border: `1px solid ${tokens.neutral.gray200}`, pointerEvents: 'none' }}>
                    <Stack spacing={4}>
                        <PdfCalendarSplitMock />
                        <Box display="flex" justifyContent="center" gap={2}>
                            <Button variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />}>表示中の形式でPDF出力</Button>
                            <Button variant="outlined" color="primary" startIcon={<GridOnIcon />}>全体マトリックスPDF</Button>
                        </Box>
                    </Stack>
                </Box>
            </StepBlock>
        </Box>
    );
}
'use client';

import { useState } from 'react';
import { Box, Typography, Paper, Stack, Chip } from '@/components/ui/mui';
import DescriptionIcon from '@mui/icons-material/Description';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import MenuBookIcon from '@mui/icons-material/MenuBook';

// マニュアル用の独立したコンテンツコンポーネントをインポート
import FormSettingsManual from '@/components/manual/FormSettingsManual';
import ShiftGuideManual from '@/components/manual/ShiftGuideManual';

export default function ManualPortalPage() {
    // 選択中のアクティブなマニュアルID
    const [activeManual, setActiveManual] = useState<'form-settings' | 'shift-guide'>('form-settings');

    // 目次データ（新しいマニュアルを追加する場合は、この配列を増やすだけで自動的にUIに反映されます）
    const manualList = [
        {
            id: 'form-settings' as const,
            title: '記録フォームの設定',
            subtitle: '利用者ごとのフォーム作成方法',
            category: '管理者向け',
            categoryColor: 'primary' as const,
            icon: <DescriptionIcon />
        },
        {
            id: 'shift-guide' as const,
            title: 'シフト管理・閲覧ガイド',
            subtitle: 'ひな形登録、D&D、PDF出力',
            category: '管理者・一般向け',
            categoryColor: 'secondary' as const,
            icon: <CalendarMonthIcon />
        }
    ];

    return (
        <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default', overflow: 'hidden' }}>

            {/* --- 左ペイン：目次サイドバー（マニュアル一覧） --- */}
            <Box sx={{
                width: 320,
                bgcolor: 'background.paper',
                borderRight: '1px solid', borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                height: '100%'
            }}>
                <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: 'background.tint' }}>
                    <MenuBookIcon color="primary" />
                    <Typography variant="h6" fontWeight="bold" color="primary.main">サポートマニュアル</Typography>
                </Box>
                <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
                    <Typography variant="caption" sx={{ px: 1, pb: 1.5, display: 'block', color: 'text.secondary', fontWeight: 'bold' }}>マニュアルを選択</Typography>
                    <Stack spacing={1.5}>
                        {manualList.map((item) => {
                            const isSelected = activeManual === item.id;
                            return (
                                <Paper
                                    key={item.id}
                                    onClick={() => setActiveManual(item.id)}
                                    variant={isSelected ? 'elevation' : 'outlined'}
                                    elevation={isSelected ? 2 : 0}
                                    sx={{
                                        p: 2,
                                        cursor: 'pointer',
                                        borderRadius: 3,
                                        transition: 'all 0.2s',
                                        border: isSelected ? '2px solid' : '1px solid',
                                        borderColor: isSelected ? 'primary.main' : 'divider',
                                        bgcolor: isSelected ? 'background.tint' : 'background.paper',
                                        '&:hover': { bgcolor: isSelected ? 'background.tint' : 'background.subtle' }
                                    }}
                                >
                                    <Stack direction="row" spacing={1.5} alignItems="center">
                                        <Box sx={{ color: isSelected ? 'primary.main' : 'text.secondary' }}>
                                            {item.icon}
                                        </Box>
                                        <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                                            <Typography variant="body2" fontWeight="bold" color={isSelected ? 'primary.main' : 'text.primary'} noWrap>
                                                {item.title}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" display="block" noWrap>
                                                {item.subtitle}
                                            </Typography>
                                            <Chip
                                                label={item.category}
                                                size="small"
                                                color={item.categoryColor}
                                                variant="outlined"
                                                sx={{ height: 16, fontSize: '0.65rem', mt: 0.5, fontWeight: 'bold' }}
                                            />
                                        </Box>
                                    </Stack>
                                </Paper>
                            );
                        })}
                    </Stack>
                </Box>
                <Box p={2.5} borderTop="1px solid" borderColor="divider" textAlign="center" bgcolor="background.subtle">
                    <Typography variant="caption" color="text.secondary">&copy; CareRecord System Manual</Typography>
                </Box>
            </Box>

            {/* --- 右ペイン：選択されたマニュアルコンテンツの表示エリア --- */}
            <Box sx={{ flexGrow: 1, bgcolor: 'background.default', overflowY: 'auto', p: { xs: 2, md: 5 } }}>
                <Paper variant="outlined" sx={{ borderRadius: 4, bgcolor: 'background.paper', p: { xs: 3, md: 6 }, border: 'none', boxShadow: 1 }}>

                    {/* 選択されたIDに応じて、分離されたコンポーネントを動的にマウント */}
                    {activeManual === 'form-settings' && <FormSettingsManual />}
                    {activeManual === 'shift-guide' && <ShiftGuideManual />}

                </Paper>
            </Box>
        </Box>
    );
}

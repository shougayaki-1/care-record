// app/helper/layout.tsx
'use client';

import { Box, Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import HistoryIcon from '@mui/icons-material/History';
import PersonIcon from '@mui/icons-material/Person';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function HelperLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [value, setValue] = useState(pathname);

    // パスが変わったらタブの選択状態も変える
    useEffect(() => {
        setValue(pathname);
    }, [pathname]);

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
            width: '100%',
            maxWidth: '100vw', // 絶対にはみ出させない
            overflowX: 'hidden'
        }}>

            {/* メインコンテンツ */}
            <Box sx={{ flexGrow: 1, width: '100%', pb: 7 }}>
                {children}
            </Box>

            {/* スマホ用ボトムナビゲーション (位置固定) */}
            <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000 }} elevation={3}>
                <BottomNavigation
                    showLabels
                    value={value}
                    onChange={(event, newValue) => {
                        setValue(newValue);
                        router.push(newValue);
                    }}
                >
                    <BottomNavigationAction label="ホーム" value="/helper" icon={<HomeIcon />} />
                    <BottomNavigationAction label="履歴" value="/helper/history" icon={<HistoryIcon />} />
                    <BottomNavigationAction label="設定" value="/profile" icon={<PersonIcon />} />
                </BottomNavigation>
            </Paper>
        </Box>
    );
}
'use client';
import { tokens } from '@/styles/tokens';

import { Box, AppBar, Toolbar, Typography, Button } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';

export default function ManualLayout({ children }: { children: React.ReactNode }) {
    return (
        // ★ 修正: bodyのスクロール禁止を回避するため、ここに height と overflowY を追加
        <Box sx={{ height: '100vh', overflowY: 'auto', bgcolor: tokens.neutral.gray100, display: 'flex', flexDirection: 'column' }}>
            
            {/* マニュアル専用の独立したヘッダー */}
            <AppBar position="sticky" elevation={1} sx={{ bgcolor: '#fff', color: '#333' }}>
                <Toolbar>
                    <Box display="flex" alignItems="center" gap={1} sx={{ flexGrow: 1 }}>
                        <MenuBookIcon color="primary" />
                        <Typography variant="h6" fontWeight="bold" color="primary.main">
                            CareRecord サポートマニュアル
                        </Typography>
                    </Box>
                    <Button 
                        variant="outlined" 
                        color="inherit" 
                        onClick={() => window.close()} 
                        sx={{ color: '#666', borderColor: '#ccc' }}
                    >
                        閉じる
                    </Button>
                </Toolbar>
            </AppBar>

            {/* マニュアル本体のコンテンツ */}
            <Box component="main" sx={{ flexGrow: 1 }}>
                {children}
            </Box>

            {/* マニュアル専用のフッター */}
            <Box component="footer" sx={{ bgcolor: '#333', color: '#fff', py: 3, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                    &copy; {new Date().getFullYear()} CareRecord. All rights reserved.
                </Typography>
            </Box>
        </Box>
    );
}
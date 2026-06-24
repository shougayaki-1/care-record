// app/super-admin/layout.tsx
'use client';
import { tokens } from '@/styles/tokens';

import { useEffect, useState } from 'react';
import { Box, AppBar, Toolbar, Typography, Button, CircularProgress, Container } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [isSuperAdmin, setIsSuperAdmin] = useState(false);

    useEffect(() => {
        checkRole();
    }, []);

    const checkRole = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            router.push('/');
            return;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profile?.role !== 'super_admin') {
            alert('権限がありません');
            router.push('/');
        } else {
            setIsSuperAdmin(true);
        }
        setLoading(false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (loading || !isSuperAdmin) {
        return (
            <Box height="100vh" display="flex" justifyContent="center" alignItems="center" bgcolor={tokens.neutral.gray100}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: tokens.neutral.gray150 }}>
            {/* --- ヘッダー --- */}
            <AppBar position="sticky" sx={{ bgcolor: '#333' }}>
                <Toolbar>
                    <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold', letterSpacing: 1 }}>
                        SUPER ADMIN CONSOLE
                    </Typography>
                    <Button color="inherit" onClick={handleLogout} startIcon={<LogoutIcon />}>
                        ログアウト
                    </Button>
                </Toolbar>
            </AppBar>

            {/* --- 中身（page.tsxの内容）が表示される場所 --- */}
            <Container maxWidth="lg" sx={{ mt: 4, pb: 4 }}>
                {children}
            </Container>
        </Box>
    );
}
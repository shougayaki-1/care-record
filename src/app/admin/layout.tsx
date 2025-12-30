// app/admin/layout.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, AppBar, Toolbar, Typography, Drawer,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Button, CircularProgress, IconButton, Container, useMediaQuery
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import DescriptionIcon from '@mui/icons-material/Description';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import EditNoteIcon from '@mui/icons-material/EditNote';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const drawerWidth = 280;
type UserRole = 'owner' | 'manager' | 'staff' | 'super_admin';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const theme = useTheme();

    // デフォルトは「モバイル（画面幅に関わらずサイドバー非表示）」
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });

    const [role, setRole] = useState<UserRole | null>(null);
    const [loading, setLoading] = useState(true);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        checkUserRole();
    }, []);

    const checkUserRole = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            router.push('/');
            return;
        }
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        if (profile) {
            if (profile.role === 'staff') router.push('/helper');
            else setRole(profile.role as UserRole);
        }
        setLoading(false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/'; // 確実にセッションを切るため
    };

    const menuItems = [
        { text: 'ダッシュボード', icon: <DashboardIcon />, path: '/admin/dashboard', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '利用者管理', icon: <PeopleIcon />, path: '/admin/clients', allowed: ['owner', 'manager', 'super_admin'] },
        { text: 'スタッフ管理', icon: <AssignmentIndIcon />, path: '/admin/staff', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '提供記録一覧', icon: <DescriptionIcon />, path: '/admin/reports', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '記録を作成する', icon: <EditNoteIcon />, path: '/helper', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '事業所設定', icon: <SettingsIcon />, path: '/admin/settings', allowed: ['owner', 'super_admin'] },
        { text: 'アカウント設定', icon: <AccountCircleIcon />, path: '/profile', allowed: ['owner', 'manager', 'super_admin'] },
    ];

    const drawerContent = (
        <Box sx={{ p: 2 }}>
            <Toolbar />
            <List>
                {menuItems.map((item) => {
                    if (role && !item.allowed.includes(role)) return null;
                    const isSelected = pathname === item.path;
                    return (
                        <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                            <ListItemButton
                                selected={isSelected}
                                onClick={() => { router.push(item.path); setMobileOpen(false); }}
                                sx={{ borderRadius: '12px', '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.1) } }}
                            >
                                <ListItemIcon sx={{ minWidth: 40, color: isSelected ? 'primary.main' : 'inherit' }}>{item.icon}</ListItemIcon>
                                <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? 'bold' : '500' }} />
                            </ListItemButton>
                        </ListItem>
                    );
                })}
            </List>
        </Box>
    );

    if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
            <AppBar position="fixed" sx={{ bgcolor: '#fff', color: '#333', boxShadow: 'none', borderBottom: '1px solid #eee', zIndex: theme.zIndex.drawer + 1 }}>
                <Toolbar>
                    <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 1, display: isDesktop ? 'none' : 'block' }}>
                        <MenuIcon />
                    </IconButton>
                    <Typography variant="h6" sx={{ flexGrow: 1, color: theme.palette.primary.main, fontWeight: '800', fontFamily: 'var(--font-poppins)' }}>CareRecord</Typography>
                    <Button color="inherit" onClick={handleLogout} sx={{ textTransform: 'none' }} startIcon={<LogoutIcon />}>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>ログアウト</Box>
                    </Button>
                </Toolbar>
            </AppBar>

            {/* モバイル用（開閉式） */}
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
            >
                {drawerContent}
            </Drawer>

            {/* PC用（固定） */}
            <Drawer
                variant="permanent"
                sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, borderRight: '1px solid #eee' } }}
            >
                {drawerContent}
            </Drawer>

            <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 4 }, mt: '64px', width: '100%' }}>
                <Container maxWidth="lg" sx={{ px: { xs: 0, sm: 2 } }}>
                    {children}
                </Container>
            </Box>
        </Box>
    );
}
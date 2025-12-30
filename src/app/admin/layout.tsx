// app/admin/layout.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, AppBar, Toolbar, Typography, Drawer,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Button, CircularProgress, IconButton, Container
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

    const [role, setRole] = useState<UserRole | null>(null);
    const [loading, setLoading] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { router.push('/'); return; }
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
            if (profile?.role === 'staff') { router.push('/helper'); }
            else { setRole(profile?.role as UserRole); }
            setLoading(false);
        };
        checkUser();
    }, [router]);

    const menuItems = [
        { text: 'ダッシュボード', icon: <DashboardIcon />, path: '/admin/dashboard', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '利用者管理', icon: <PeopleIcon />, path: '/admin/clients', allowed: ['owner', 'manager', 'super_admin'] },
        { text: 'スタッフ管理', icon: <AssignmentIndIcon />, path: '/admin/staff', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '提供記録一覧', icon: <DescriptionIcon />, path: '/admin/reports', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '記録を作成する', icon: <EditNoteIcon />, path: '/helper', allowed: ['owner', 'manager', 'super_admin'] },
        { text: '事業所設定', icon: <SettingsIcon />, path: '/admin/settings', allowed: ['owner', 'super_admin'] },
        { text: 'アカウント設定', icon: <AccountCircleIcon />, path: '/profile', allowed: ['owner', 'manager', 'super_admin'] },
    ];

    if (loading) return <Box sx={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
            <AppBar position="fixed" sx={{ bgcolor: '#fff', color: '#333', boxShadow: 'none', borderBottom: '1px solid #e0e0e0', zIndex: theme.zIndex.drawer + 1 }}>
                <Toolbar>
                    <IconButton edge="start" onClick={() => setMenuOpen(true)} sx={{ mr: 2 }}><MenuIcon /></IconButton>
                    <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 800, color: '#2255CC', fontFamily: 'var(--font-poppins)' }}>CareRecord</Typography>
                    <Button color="inherit" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }} startIcon={<LogoutIcon />}>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>ログアウト</Box>
                    </Button>
                </Toolbar>
            </AppBar>

            <Drawer anchor="left" open={menuOpen} onClose={() => setMenuOpen(false)}>
                <Box sx={{ width: drawerWidth, p: 2, pt: 8 }}>
                    <List>
                        {menuItems.map((item) => {
                            if (role && !item.allowed.includes(role)) return null;
                            const isSelected = pathname === item.path;
                            return (
                                <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                                    <ListItemButton
                                        selected={isSelected}
                                        onClick={() => { router.push(item.path); setMenuOpen(false); }}
                                        sx={{ borderRadius: '12px', '&.Mui-selected': { bgcolor: alpha('#2255CC', 0.1), color: '#2255CC' } }}
                                    >
                                        <ListItemIcon sx={{ color: isSelected ? '#2255CC' : 'inherit' }}>{item.icon}</ListItemIcon>
                                        <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? 700 : 500 }} />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                </Box>
            </Drawer>

            <Box component="main" sx={{ flexGrow: 1, pt: 10, pb: 6, width: '100%' }}>
                <Container maxWidth="lg">
                    {children}
                </Container>
            </Box>
        </Box>
    );
}
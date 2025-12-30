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
        router.push('/');
    };

    const toggleMenu = (open: boolean) => () => {
        setMenuOpen(open);
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

    if (loading) return (
        <Box sx={{ height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100vw', minHeight: '100vh', overflowX: 'hidden' }}>
            {/* ヘッダー */}
            <AppBar position="fixed" sx={{ bgcolor: '#fff', color: '#333', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', zIndex: theme.zIndex.drawer + 1 }}>
                <Toolbar>
                    <IconButton color="inherit" edge="start" onClick={toggleMenu(true)} sx={{ mr: 1 }}>
                        <MenuIcon />
                    </IconButton>
                    <Typography variant="h6" noWrap sx={{ flexGrow: 1, color: theme.palette.primary.main, fontWeight: '800', fontFamily: 'var(--font-poppins)' }}>
                        CareRecord
                    </Typography>
                    <IconButton color="inherit" onClick={handleLogout} size="small">
                        <LogoutIcon />
                    </IconButton>
                </Toolbar>
            </AppBar>

            {/* スライドメニュー */}
            <Drawer
                anchor="left"
                open={menuOpen}
                onClose={toggleMenu(false)}
                PaperProps={{ sx: { width: drawerWidth } }}
            >
                <Box sx={{ p: 2, pt: 4 }}>
                    <Typography variant="h6" fontWeight="800" color="primary" sx={{ mb: 3, px: 2 }}>Menu</Typography>
                    <List>
                        {menuItems.map((item) => {
                            if (role && !item.allowed.includes(role)) return null;
                            const isSelected = pathname === item.path;
                            return (
                                <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                                    <ListItemButton
                                        selected={isSelected}
                                        onClick={() => {
                                            router.push(item.path); // ここを item.id から item.path に修正しました
                                            setMenuOpen(false);
                                        }}
                                        sx={{
                                            borderRadius: '12px',
                                            '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.1) }
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 40, color: isSelected ? 'primary.main' : 'inherit' }}>
                                            {item.icon}
                                        </ListItemIcon>
                                        <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? 'bold' : '500' }} />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                </Box>
            </Drawer>

            {/* メインコンテンツ */}
            <Box component="main" sx={{ flexGrow: 1, pt: '80px', pb: 4, width: '100vw' }}>
                <Container maxWidth="lg">
                    {children}
                </Container>
            </Box>
        </Box>
    );
}
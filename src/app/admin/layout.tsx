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
    const [menuOpen, setMenuOpen] = useState(false); // 全デバイス共通の開閉状態

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

    const toggleMenu = (open: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
        if (event.type === 'keydown' && ((event as React.KeyboardEvent).key === 'Tab' || (event as React.KeyboardEvent).key === 'Shift')) return;
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

    if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {/* --- ヘッダー (全デバイス共通) --- */}
            <AppBar
                position="fixed"
                sx={{
                    bgcolor: '#ffffff',
                    color: '#333',
                    boxShadow: 'none',
                    borderBottom: '1px solid #eee',
                    zIndex: (theme) => theme.zIndex.drawer + 1
                }}
            >
                <Toolbar>
                    <IconButton
                        color="inherit"
                        edge="start"
                        onClick={toggleMenu(true)}
                        sx={{ mr: 2 }}
                    >
                        <MenuIcon />
                    </IconButton>

                    <Typography
                        variant="h6"
                        noWrap
                        component="div"
                        sx={{
                            flexGrow: 1,
                            color: theme.palette.primary.main,
                            fontWeight: '800',
                            fontFamily: 'var(--font-poppins)',
                            fontSize: { xs: '1.1rem', sm: '1.25rem' }
                        }}
                    >
                        CareRecord
                    </Typography>

                    <Button color="inherit" onClick={handleLogout} sx={{ color: '#666', textTransform: 'none' }}>
                        <LogoutIcon sx={{ mr: 0.5, fontSize: 20 }} />
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>ログアウト</Box>
                    </Button>
                </Toolbar>
            </AppBar>

            {/* --- サイドメニュー (全デバイス共通: スライド式) --- */}
            <Drawer
                anchor="left"
                open={menuOpen}
                onClose={toggleMenu(false)}
                PaperProps={{ sx: { width: drawerWidth, border: 'none' } }}
            >
                <Box sx={{ p: 2 }}>
                    <Box sx={{ mb: 2, px: 1, py: 2 }}>
                        <Typography variant="h6" fontWeight="800" color="primary">Menu</Typography>
                    </Box>
                    <List>
                        {menuItems.map((item) => {
                            if (role && !item.allowed.includes(role)) return null;
                            const isSelected = pathname === item.path;
                            return (
                                <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                                    <ListItemButton
                                        selected={isSelected}
                                        onClick={() => {
                                            router.push(item.path);
                                            setMenuOpen(false);
                                        }}
                                        sx={{
                                            borderRadius: '12px',
                                            py: 1.5,
                                            '&.Mui-selected': {
                                                bgcolor: alpha(theme.palette.primary.main, 0.12),
                                                color: theme.palette.primary.main,
                                                fontWeight: 'bold',
                                                '& .MuiListItemIcon-root': { color: theme.palette.primary.main }
                                            }
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 40, color: isSelected ? theme.palette.primary.main : '#777' }}>
                                            {item.icon}
                                        </ListItemIcon>
                                        <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? '700' : '500' }} />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                </Box>
            </Drawer>

            {/* --- メインコンテンツ --- */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    bgcolor: 'background.default',
                    pt: '80px', // AppBarの高さ分確保
                    pb: 4,
                    minHeight: '100vh',
                    width: '100%'
                }}
            >
                <Container maxWidth="lg">
                    {children}
                </Container>
            </Box>
        </Box>
    );
}
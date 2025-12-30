'use client';

import { useEffect, useState } from 'react';
import {
    Box, AppBar, Toolbar, Typography, Drawer,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Button, CircularProgress, IconButton
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

const drawerWidth = 260;

type UserRole = 'owner' | 'manager' | 'staff' | 'super_admin';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const theme = useTheme();

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

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profile) {
            if (profile.role === 'staff') {
                router.push('/helper');
            } else {
                setRole(profile.role as UserRole);
            }
        }
        setLoading(false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
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

    const drawer = (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* ドロワー内ヘッダー */}
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #eee' }}>
                <Typography variant="h6" fontWeight="800" color="primary">CareRecord</Typography>
            </Box>

            <Box sx={{ overflow: 'auto', p: 2, flexGrow: 1 }}>
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
                                        setMobileOpen(false); // メニュー選択時に閉じる
                                    }}
                                    sx={{
                                        borderRadius: '12px',
                                        py: 1.5,
                                        color: '#555',
                                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                                        '&.Mui-selected': {
                                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                                            color: theme.palette.primary.main,
                                            fontWeight: 'bold',
                                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                                            '& .MuiListItemIcon-root': { color: theme.palette.primary.main }
                                        }
                                    }}
                                >
                                    <ListItemIcon sx={{ minWidth: 40, color: isSelected ? theme.palette.primary.main : '#777' }}>
                                        {item.icon}
                                    </ListItemIcon>
                                    <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? '700' : '500', fontSize: '0.95rem' }} />
                                </ListItemButton>
                            </ListItem>
                        );
                    })}
                </List>
            </Box>
        </Box>
    );

    if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
            {/* ヘッダー (固定) */}
            <AppBar
                position="sticky"
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
                        onClick={handleDrawerToggle}
                        sx={{ mr: 2 }}
                    >
                        <MenuIcon />
                    </IconButton>

                    <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, color: theme.palette.primary.main, fontWeight: '800', letterSpacing: '0.5px' }}>
                        CareRecord SaaS
                    </Typography>
                    <Button color="inherit" startIcon={<LogoutIcon />} onClick={handleLogout} sx={{ color: '#666' }}>
                        ログアウト
                    </Button>
                </Toolbar>
            </AppBar>

            {/* ドロワー (開閉式・全デバイス共通) */}
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={handleDrawerToggle}
                ModalProps={{ keepMounted: true }}
                sx={{
                    '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                }}
            >
                {drawer}
            </Drawer>

            {/* メインコンテンツ */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    p: 3,
                    width: '100%',
                    bgcolor: 'background.default',
                }}
            >
                {children}
            </Box>
        </Box>
    );
}
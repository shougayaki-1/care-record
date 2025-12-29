'use client';

import { useEffect, useState } from 'react';
import {
    Box, AppBar, Toolbar, Typography, Drawer,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Button, CircularProgress, IconButton
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu'; // ハンバーガーアイコン
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
    const [mobileOpen, setMobileOpen] = useState(false); // スマホメニューの開閉状態

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

    // メニューの中身（PC/スマホ共通）
    const drawer = (
        <Box sx={{ overflow: 'auto', p: 2 }}>
            {/* スマホ版ドロワーにはヘッダーの高さ分の余白を入れる */}
            <Toolbar sx={{ display: { sm: 'none' } }} />
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
                                    setMobileOpen(false); // スマホならメニュー閉じる
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
    );

    if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

    return (
        <Box sx={{ display: 'flex' }}>
            <AppBar
                position="fixed"
                sx={{
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    bgcolor: '#ffffff',
                    color: '#333',
                    boxShadow: 'none',
                    borderBottom: '1px solid #eee',
                    width: { sm: `calc(100% - ${drawerWidth}px)` }, // PCではドロワーの幅分縮める
                    ml: { sm: `${drawerWidth}px` }
                }}
            >
                <Toolbar>
                    {/* ハンバーガーメニュー (スマホのみ表示) */}
                    <IconButton
                        color="inherit"
                        edge="start"
                        onClick={handleDrawerToggle}
                        sx={{ mr: 2, display: { sm: 'none' } }}
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

            <Box
                component="nav"
                sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
            >
                {/* スマホ用ドロワー (一時的) */}
                <Drawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={handleDrawerToggle}
                    ModalProps={{ keepMounted: true }} // パフォーマンス向上
                    sx={{
                        display: { xs: 'block', sm: 'none' },
                        '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
                    }}
                >
                    {drawer}
                </Drawer>

                {/* PC用ドロワー (常時) */}
                <Drawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', sm: 'block' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: drawerWidth,
                            borderRight: '1px solid #f0f0f0',
                            top: '64px', // ヘッダーの下から開始したい場合調整。AppBarのzIndexが高いのでこのままでOK
                            height: '100%'
                        },
                    }}
                    open
                >
                    <Toolbar /> {/* ヘッダー分のスペーサー */}
                    {drawer}
                </Drawer>
            </Box>

            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    p: 3,
                    width: { sm: `calc(100% - ${drawerWidth}px)` },
                    bgcolor: 'background.default',
                    minHeight: '100vh',
                    mt: '64px' // ヘッダーの高さ分下げる
                }}
            >
                {children}
            </Box>
        </Box>
    );
}
// app/admin/layout.tsx
'use client';

import { useEffect, useState } from 'react';
import {
    Box, AppBar, Toolbar, Typography, Drawer,
    List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Button, CircularProgress
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import DescriptionIcon from '@mui/icons-material/Description';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import EditNoteIcon from '@mui/icons-material/EditNote';
import AccountCircleIcon from '@mui/icons-material/AccountCircle'; // 追加
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

    // メニュー定義
    const menuItems = [
        {
            text: 'ダッシュボード',
            icon: <DashboardIcon />,
            path: '/admin/dashboard',
            allowed: ['owner', 'manager', 'super_admin']
        },
        {
            text: '利用者管理',
            icon: <PeopleIcon />,
            path: '/admin/clients',
            allowed: ['owner', 'manager', 'super_admin']
        },
        {
            text: 'スタッフ管理',
            icon: <AssignmentIndIcon />,
            path: '/admin/staff',
            allowed: ['owner', 'manager', 'super_admin']
        },
        {
            text: '提供記録一覧',
            icon: <DescriptionIcon />,
            path: '/admin/reports',
            allowed: ['owner', 'manager', 'super_admin']
        },
        {
            text: '記録を作成する',
            icon: <EditNoteIcon />,
            path: '/helper',
            allowed: ['owner', 'manager', 'super_admin']
        },
        {
            text: '事業所設定',
            icon: <SettingsIcon />,
            path: '/admin/settings',
            allowed: ['owner', 'super_admin']
        },
        // ↓ ここに追加
        {
            text: 'アカウント設定',
            icon: <AccountCircleIcon />,
            path: '/profile',
            allowed: ['owner', 'manager', 'super_admin']
        },
    ];

    if (loading) {
        return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ display: 'flex' }}>
            <AppBar
                position="fixed"
                sx={{
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    bgcolor: '#ffffff',
                    color: '#333',
                    boxShadow: 'none',
                    borderBottom: '1px solid #eee'
                }}
            >
                <Toolbar>
                    <Typography
                        variant="h6"
                        noWrap
                        component="div"
                        sx={{
                            flexGrow: 1,
                            color: theme.palette.primary.main,
                            fontWeight: '800',
                            letterSpacing: '0.5px'
                        }}
                    >
                        CareRecord SaaS
                    </Typography>
                    <Button
                        color="inherit"
                        startIcon={<LogoutIcon />}
                        onClick={handleLogout}
                        sx={{ color: '#666', '&:hover': { color: theme.palette.error.main, bgcolor: 'transparent' } }}
                    >
                        ログアウト
                    </Button>
                </Toolbar>
            </AppBar>

            <Drawer
                variant="permanent"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    [`& .MuiDrawer-paper`]: {
                        width: drawerWidth,
                        boxSizing: 'border-box',
                        bgcolor: '#ffffff',
                        borderRight: '1px solid #f0f0f0',
                    },
                }}
            >
                <Toolbar />
                <Box sx={{ overflow: 'auto', p: 2 }}>
                    <List>
                        {menuItems.map((item) => {
                            if (role && !item.allowed.includes(role)) return null;

                            const isSelected = pathname === item.path;

                            return (
                                <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
                                    <ListItemButton
                                        selected={isSelected}
                                        onClick={() => router.push(item.path)}
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
                                        <ListItemIcon
                                            sx={{ minWidth: 40, color: isSelected ? theme.palette.primary.main : '#777' }}
                                        >
                                            {item.icon}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={item.text}
                                            primaryTypographyProps={{ fontWeight: isSelected ? '700' : '500', fontSize: '0.95rem' }}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                </Box>
            </Drawer>

            <Box component="main" sx={{ flexGrow: 1, p: 4, width: `calc(100% - ${drawerWidth}px)`, bgcolor: 'background.default', minHeight: '100vh' }}>
                <Toolbar />
                {children}
            </Box>
        </Box>
    );
}

'use client';

import { useState } from 'react';
import {
  Box, Avatar, Tooltip, IconButton, Divider, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Drawer, AppBar, Toolbar, useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EditNoteIcon from '@mui/icons-material/EditNote';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/History';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import DescriptionIcon from '@mui/icons-material/Description';
import SettingsIcon from '@mui/icons-material/Settings';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
// 未使用の AddIcon を削除
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const WORKSPACE_WIDTH = 68;
const SIDEBAR_WIDTH = 240;

// コンポーネント外に定義
const DrawerContent = ({ onClose }: { onClose?: () => void }) => {
  const { currentOrg, orgList, switchOrg } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const getMenuItems = () => {
    if (!currentOrg) return [];
    
    // 全員共通
    const items = [
      { text: '記録を作成', icon: <EditNoteIcon />, path: '/app/record' },
      { text: '自分の履歴', icon: <HistoryIcon />, path: '/app/history' },
    ];

    // 管理者以上
    if (['owner', 'manager'].includes(currentOrg.role)) {
      items.unshift({ text: 'ダッシュボード', icon: <DashboardIcon />, path: '/app/dashboard' });
      items.push(
        { text: '利用者管理', icon: <PeopleIcon />, path: '/app/clients' },
        { text: 'スタッフ管理', icon: <AssignmentIndIcon />, path: '/app/staff' },
        { text: '提供記録一覧', icon: <DescriptionIcon />, path: '/app/reports' }
      );
    }

    // オーナーのみ
    if (currentOrg.role === 'owner') {
      items.push({ text: '事業所設定', icon: <SettingsIcon />, path: '/app/settings' });
    }

    // 共通（下部）
    items.push({ text: 'アカウント設定', icon: <AccountCircleIcon />, path: '/app/profile' });
    
    return items;
  };

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      {/* 1. ワークスペーススイッチャー (左端) */}
      <Box sx={{
        width: WORKSPACE_WIDTH,
        bgcolor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 2,
        gap: 2,
        borderRight: '1px solid #333'
      }}>
        {orgList.map(org => (
          <Tooltip key={org.id} title={org.name} placement="right">
            <IconButton onClick={() => switchOrg(org.id)} sx={{ p: 0 }}>
              <Avatar
                variant="rounded"
                sx={{
                  bgcolor: currentOrg?.id === org.id ? '#2255CC' : '#444',
                  color: '#fff',
                  border: currentOrg?.id === org.id ? '2px solid #fff' : 'none',
                  transition: '0.2s',
                  width: 44, height: 44,
                  fontSize: '1rem',
                  fontWeight: 'bold'
                }}
              >
                {org.name.slice(0, 1)}
              </Avatar>
            </IconButton>
          </Tooltip>
        ))}
      </Box>

      {/* 2. 機能メニューサイドバー */}
      <Box sx={{ width: SIDEBAR_WIDTH, bgcolor: '#fff', display: 'flex', flexDirection: 'column' }}>
        <Box p={2} sx={{ borderBottom: '1px solid #eee' }}>
          <Typography variant="subtitle1" fontWeight="bold" noWrap>
            {currentOrg?.name || '未所属'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            権限: {currentOrg?.role === 'staff' ? 'ヘルパー' : currentOrg?.role === 'manager' ? '管理者' : '代表'}
          </Typography>
        </Box>
        
        <List sx={{ flexGrow: 1, pt: 1 }}>
          {getMenuItems().map(item => {
            const isSelected = pathname === item.path || pathname.startsWith(item.path + '/');
            return (
              <ListItem key={item.path} disablePadding>
                <ListItemButton
                  selected={isSelected}
                  onClick={() => {
                    router.push(item.path);
                    if (onClose) onClose();
                  }}
                  sx={{
                    mx: 1, borderRadius: 2, mb: 0.5,
                    '&.Mui-selected': { bgcolor: '#eef2ff', color: '#2255CC' }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40, color: isSelected ? '#2255CC' : 'inherit' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText primary={item.text} primaryTypographyProps={{ fontWeight: isSelected ? 'bold' : 'medium' }} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        <Divider />
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={handleLogout}>
              <ListItemIcon><LogoutIcon /></ListItemIcon>
              <ListItemText primary="ログアウト" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Box>
  );
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f5f5f5' }}>
      
      {/* モバイル用ヘッダー */}
      {isMobile && (
        <AppBar position="fixed" sx={{ bgcolor: '#fff', color: '#333', boxShadow: 'none', borderBottom: '1px solid #ddd' }}>
          <Toolbar>
            <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 2 }}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" fontWeight="bold" color="primary">CareRecord</Typography>
          </Toolbar>
        </AppBar>
      )}

      {/* ナビゲーションドロワー */}
      <Box
        component="nav"
        sx={{ width: { md: WORKSPACE_WIDTH + SIDEBAR_WIDTH }, flexShrink: { md: 0 } }}
      >
        {/* モバイル用 */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { width: WORKSPACE_WIDTH + SIDEBAR_WIDTH },
          }}
        >
          <DrawerContent onClose={() => setMobileOpen(false)} />
        </Drawer>

        {/* PC用 */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { width: WORKSPACE_WIDTH + SIDEBAR_WIDTH, boxSizing: 'border-box', border: 'none' },
          }}
          open
        >
          <DrawerContent />
        </Drawer>
      </Box>

      {/* メインコンテンツ */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${WORKSPACE_WIDTH + SIDEBAR_WIDTH}px)` },
          mt: { xs: 7, md: 0 },
          overflowX: 'hidden'
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
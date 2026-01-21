'use client';

import { useState, useEffect } from 'react';
import {
  Box, Avatar, Tooltip, IconButton, Divider, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Drawer, useMediaQuery, Collapse
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import TagIcon from '@mui/icons-material/Tag';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import PeopleIcon from '@mui/icons-material/People';
import BadgeIcon from '@mui/icons-material/Badge';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import LogoutIcon from '@mui/icons-material/Logout';
import BusinessIcon from '@mui/icons-material/Business';

import { useWorkspace, Workspace } from '@/context/WorkspaceContext';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const RAIL_WIDTH = 72;
const SIDEBAR_WIDTH = 240;

// 1. 左端レール (事業所切り替え)
const ServerRail = ({ orgList, currentOrg, switchOrg }: { orgList: Workspace[], currentOrg: Workspace | null, switchOrg: (id: string) => void }) => {
  const router = useRouter(); // ★追加: ルーターを使用

  return (
    <Box sx={{
      width: RAIL_WIDTH,
      bgcolor: '#E3E5E8', 
      borderRight: 'none',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      py: 2,
      gap: 1.5,
      overflowY: 'auto',
      flexShrink: 0,
      '&::-webkit-scrollbar': { display: 'none' }
    }}>
      {orgList.map(org => {
        const isSelected = currentOrg?.id === org.id;
        return (
          <Tooltip key={org.id} title={org.name} placement="right">
            <IconButton 
              onClick={() => switchOrg(org.id)}
              sx={{ 
                p: 0,
                border: isSelected ? `2px solid #2255CC` : '2px solid transparent',
                borderRadius: '50%',
                transition: 'all 0.2s',
                '&:hover': {
                   borderColor: isSelected ? '#2255CC' : 'rgba(0,0,0,0.1)'
                }
              }}
            >
              <Avatar
                sx={{
                  bgcolor: isSelected ? '#2255CC' : '#F2F3F5',
                  color: isSelected ? '#fff' : '#555',
                  width: 48, height: 48,
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  boxShadow: isSelected ? 2 : 0,
                  transition: 'all 0.2s',
                  '&:hover': { bgcolor: isSelected ? '#2255CC' : '#fff' }
                }}
              >
                {org.name.slice(0, 1)}
              </Avatar>
            </IconButton>
          </Tooltip>
        );
      })}
      
      <Divider flexItem sx={{ mx: 2, borderColor: 'rgba(0,0,0,0.06)' }} />
      
      <Tooltip title="事業所を追加 / 参加" placement="right">
        <IconButton 
          sx={{ 
            width: 48, height: 48, 
            bgcolor: '#F2F3F5', color: '#23A559',
            transition: 'all 0.2s',
            '&:hover': { bgcolor: '#23A559', color: '#fff' }
          }}
          onClick={() => router.push('/setup')} // ★修正: セットアップ画面へ遷移
        >
          <AddIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

// ... (以下、ChannelSidebar, UserPanel, AppLayout は変更なし。以前のコードを維持)
// 省略せずに記述する場合は、前回のAppLayout.tsxの残りの部分（ChannelSidebar以降）をここに続けてください。
// ここでは変更点のある ServerRail 部分のみ抜粋して解説していますが、
// 実際にはファイル全体を書き換える形になります。

// --- 以下、既存コードのまま ---
const ChannelSidebar = ({ currentOrg, onClose }: { currentOrg: Workspace | null, onClose?: () => void }) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openReports, setOpenReports] = useState(true);

  if (!currentOrg) return null;

  const handleNav = (path: string) => {
    router.push(path);
    if (onClose) onClose();
  };

  const isActive = (path: string, queryCheck?: { key: string, val: string }) => {
    if (pathname !== path) return false;
    if (queryCheck) return searchParams.get(queryCheck.key) === queryCheck.val;
    if (!queryCheck && Array.from(searchParams.keys()).length === 0) return true;
    return false;
  };

  const isAdmin = ['owner', 'manager'].includes(currentOrg.role);
  const isOwner = currentOrg.role === 'owner';

  const categoryStyle = {
    px: 2, pt: 2.5, pb: 1,
    fontSize: '0.75rem',
    fontWeight: 'bold',
    color: '#6D6F78', 
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    ml: 1
  };

  const itemStyle = (active: boolean) => ({
    mx: 1,
    borderRadius: '4px',
    mb: 0.25,
    color: active ? '#060607' : '#5C5E66',
    bgcolor: active ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
    fontWeight: active ? 600 : 500,
    '&:hover': {
      bgcolor: active ? 'rgba(0, 0, 0, 0.04)' : 'rgba(0, 0, 0, 0.02)',
      color: '#060607'
    },
    '& .MuiListItemIcon-root': {
      color: active ? '#060607' : '#5C5E66',
      minWidth: 32
    }
  });

  return (
    <Box sx={{ 
      width: SIDEBAR_WIDTH, 
      bgcolor: '#F2F3F5',
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      borderRight: 'none'
    }}>
      <Box sx={{ 
        height: 48, 
        display: 'flex', 
        alignItems: 'center', 
        px: 2, 
        flexShrink: 0,
        boxShadow: '0 1px 0 rgba(0,0,0,0.05)',
        cursor: 'default'
      }}>
        <Typography variant="subtitle1" fontWeight="800" noWrap sx={{ color: '#060607' }}>
          {currentOrg.name}
        </Typography>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', py: 1 }}>
        <Typography sx={categoryStyle}>記録</Typography>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/record')} sx={itemStyle(isActive('/app/record'))}>
              <ListItemIcon><EditNoteIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="記録を作成" primaryTypographyProps={{ fontSize: '0.95rem' }} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/history')} sx={itemStyle(isActive('/app/history'))}>
              <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="自分の履歴" primaryTypographyProps={{ fontSize: '0.95rem' }} />
            </ListItemButton>
          </ListItem>
        </List>

        {isAdmin && (
          <>
            <Box onClick={() => setOpenReports(!openReports)} sx={{ ...categoryStyle, display: 'flex', alignItems: 'center', cursor: 'pointer', '&:hover': { color: '#060607' } }}>
              提供記録一覧
              {openReports ? <ExpandLess fontSize="small" sx={{ ml: 'auto' }} /> : <ExpandMore fontSize="small" sx={{ ml: 'auto' }} />}
            </Box>
            <Collapse in={openReports} timeout="auto" unmountOnExit>
              <List disablePadding>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleNav('/app/reports')} sx={itemStyle(isActive('/app/reports'))}>
                    <ListItemIcon><TagIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="全件表示" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleNav('/app/reports?status=unapproved')} sx={itemStyle(isActive('/app/reports', { key: 'status', val: 'unapproved' }))}>
                    <ListItemIcon><WarningAmberIcon fontSize="small" color="warning" /></ListItemIcon>
                    <ListItemText primary="未承認・差戻し" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                  </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleNav('/app/reports?period=current_month')} sx={itemStyle(isActive('/app/reports', { key: 'period', val: 'current_month' }))}>
                    <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="今月の記録" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                  </ListItemButton>
                </ListItem>
              </List>
            </Collapse>

            <Typography sx={categoryStyle}>管理</Typography>
            <List disablePadding>
              {isOwner && (
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleNav('/app/settings')} sx={itemStyle(isActive('/app/settings'))}>
                    <ListItemIcon><BusinessIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="事業所設定" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                  </ListItemButton>
                </ListItem>
              )}
              
              <ListItem disablePadding>
                <ListItemButton onClick={() => handleNav('/app/clients')} sx={itemStyle(isActive('/app/clients'))}>
                  <ListItemIcon><PeopleIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="利用者管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton onClick={() => handleNav('/app/staff')} sx={itemStyle(isActive('/app/staff'))}>
                  <ListItemIcon><BadgeIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="スタッフ管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                </ListItemButton>
              </ListItem>
            </List>
          </>
        )}
      </Box>
    </Box>
  );
};

const UserPanel = ({ onClose }: { onClose?: () => void }) => {
  const router = useRouter();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).single();
        if (profile) setUserName(profile.name);
      }
    };
    fetchUser();
  }, []);

  const handleNav = (path: string) => { router.push(path); if (onClose) onClose(); };
  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/'); };

  return (
    <Box sx={{ 
      height: 52, 
      bgcolor: '#EBEDEF', 
      display: 'flex', 
      alignItems: 'center', 
      px: 1.5,
      flexShrink: 0,
      width: '100%'
    }}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: '#2255CC', fontSize: '0.8rem', mr: 1.5 }}>
        {userName ? userName.slice(0, 1) : 'U'}
      </Avatar>
      
      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        <Typography variant="caption" fontWeight="bold" noWrap sx={{ display: 'block', color: '#060607', fontSize: '0.85rem' }}>
          {userName || 'アカウント'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }} noWrap>
          オンライン
        </Typography>
      </Box>

      <Tooltip title="設定">
        <IconButton size="small" onClick={() => handleNav('/app/profile')}>
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="ログアウト">
        <IconButton size="small" onClick={handleLogout}>
          <LogoutIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { orgList, currentOrg, switchOrg } = useWorkspace();

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: '#ffffff' }}>
      
      {isMobile && (
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, height: 48, bgcolor: '#F2F3F5', borderBottom: '1px solid #E3E5E8', display: 'flex', alignItems: 'center', px: 2, zIndex: 1200 }}>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} size="small" sx={{ mr: 2 }}><MenuIcon /></IconButton>
          <Typography variant="subtitle1" fontWeight="bold" color="#060607">{currentOrg?.name || 'CareRecord'}</Typography>
        </Box>
      )}

      <Box sx={{
        width: RAIL_WIDTH + SIDEBAR_WIDTH,
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        height: '100%',
        bgcolor: '#E3E5E8' 
      }}>
        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          <ServerRail orgList={orgList} currentOrg={currentOrg} switchOrg={switchOrg} />
          <ChannelSidebar currentOrg={currentOrg} />
        </Box>
        <UserPanel />
      </Box>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: RAIL_WIDTH + SIDEBAR_WIDTH } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
            <ServerRail orgList={orgList} currentOrg={currentOrg} switchOrg={(id) => { switchOrg(id); setMobileOpen(false); }} />
            <ChannelSidebar currentOrg={currentOrg} onClose={() => setMobileOpen(false)} />
          </Box>
          <UserPanel onClose={() => setMobileOpen(false)} />
        </Box>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: '#FFFFFF',
          height: '100vh',
          display: 'flex', 
          flexDirection: 'column',
          overflow: 'hidden',
          pt: { xs: 6, md: 0 }
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
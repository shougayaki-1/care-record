'use client';
import { tokens } from '@/styles/tokens';

import { useState, useEffect } from 'react';
import {
  Box, Avatar, Tooltip, IconButton, Divider, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Drawer, useMediaQuery, Collapse, Badge, Popover, CircularProgress
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
import NotificationsIcon from '@mui/icons-material/Notifications';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AssessmentIcon from '@mui/icons-material/Assessment';
import KeyIcon from '@mui/icons-material/Key';

import { useWorkspace, Workspace } from '@/context/WorkspaceContext';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const RAIL_WIDTH = 72;
const SIDEBAR_WIDTH = 240;

type Notification = {
  id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  type: string;
  link_url?: string;
};

const NotificationsPopover = ({ anchorEl, onClose }: { anchorEl: HTMLElement | null, onClose: () => void }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchNotifications = async () => {
      setLoading(true);
      const { data } = await supabase.from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      setNotifications((data as Notification[]) || []);
      setLoading(false);
    };

    if (anchorEl) fetchNotifications();
  }, [anchorEl]);

  const handleRead = async (n: Notification) => {
    if (!n.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id);
    }
    if (n.link_url) {
      router.push(n.link_url);
      onClose();
    }
  };

  const open = Boolean(anchorEl);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{ sx: { width: 320, maxHeight: 400 } }}
    >
      <Box p={2} borderBottom="1px solid #eee">
        <Typography fontWeight="bold">通知</Typography>
      </Box>
      {loading ? <Box p={2} textAlign="center"><CircularProgress size={20} /></Box> : (
        <List sx={{ p: 0 }}>
          {notifications.length === 0 && <Box p={2} textAlign="center" color="text.secondary">通知はありません</Box>}
          {notifications.map(n => (
            <ListItemButton key={n.id} onClick={() => handleRead(n)} sx={{ bgcolor: n.is_read ? 'white' : tokens.blueTint.faint, borderBottom: `1px solid ${tokens.neutral.gray100}` }}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                {n.type === 'approve' ? <CheckCircleIcon color="success" fontSize="small" /> : <ErrorOutlineIcon color="error" fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={n.content}
                secondary={new Date(n.created_at).toLocaleString()}
                primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: n.is_read ? 'normal' : 'bold' }}
                secondaryTypographyProps={{ fontSize: '0.75rem' }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </Popover>
  );
};

const ServerRail = ({ orgList, currentOrg, switchOrg }: { orgList: Workspace[], currentOrg: Workspace | null, switchOrg: (id: string) => void }) => {
  const router = useRouter();

  return (
    <Box sx={{
      width: RAIL_WIDTH,
      bgcolor: tokens.neutral.border,
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
                border: isSelected ? `2px solid ${tokens.brand.primary}` : '2px solid transparent',
                borderRadius: '50%',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: isSelected ? tokens.brand.primary : 'rgba(0,0,0,0.1)'
                }
              }}
            >
              <Avatar
                sx={{
                  bgcolor: isSelected ? tokens.brand.primary : tokens.neutral.surface,
                  color: isSelected ? '#fff' : '#555',
                  width: 48, height: 48,
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  boxShadow: isSelected ? 2 : 0,
                  transition: 'all 0.2s',
                  '&:hover': { bgcolor: isSelected ? tokens.brand.primary : '#fff' }
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
            bgcolor: tokens.neutral.surface, color: tokens.status.success.main,
            transition: 'all 0.2s',
            '&:hover': { bgcolor: tokens.status.success.main, color: '#fff' }
          }}
          onClick={() => router.push('/setup')}
        >
          <AddIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

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
    color: tokens.text.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    ml: 1
  };

  const itemStyle = (active: boolean) => ({
    mx: 1,
    borderRadius: '4px',
    mb: 0.25,
    color: active ? tokens.text.strong : tokens.text.secondary,
    bgcolor: active ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
    fontWeight: active ? 600 : 500,
    '&:hover': {
      bgcolor: active ? 'rgba(0, 0, 0, 0.04)' : 'rgba(0, 0, 0, 0.02)',
      color: tokens.text.strong
    },
    '& .MuiListItemIcon-root': {
      color: active ? tokens.text.strong : tokens.text.secondary,
      minWidth: 32
    }
  });

  return (
    <Box sx={{
      width: SIDEBAR_WIDTH,
      bgcolor: tokens.neutral.surface,
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
        <Typography variant="subtitle1" fontWeight="800" noWrap sx={{ color: tokens.text.strong }}>
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

        <Typography sx={categoryStyle}>シフト</Typography>
        <List disablePadding>
          {/* 旧「シフト一覧(list)」と「全体シフト管理(manage)」への分岐を廃止し、統合された1つのシフトカレンダーに一本化 */}
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/shifts/manage')} sx={itemStyle(isActive('/app/shifts/manage'))}>
              <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="シフト管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
            </ListItemButton>
          </ListItem>
        </List>

        {isAdmin && (
          <>
            <Box onClick={() => setOpenReports(!openReports)} sx={{ ...categoryStyle, display: 'flex', alignItems: 'center', cursor: 'pointer', '&:hover': { color: tokens.text.strong } }}>
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
                  <ListItemText primary="スタッフ(名簿)管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                </ListItemButton>
              </ListItem>

              {isAdmin && (
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleNav('/app/accounts')} sx={itemStyle(isActive('/app/accounts'))}>
                    <ListItemIcon><KeyIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="アカウント(権限)管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
                  </ListItemButton>
                </ListItem>
              )}
              <ListItem disablePadding>
                <ListItemButton onClick={() => handleNav('/app/statistics')} sx={itemStyle(isActive('/app/statistics'))}>
                  <ListItemIcon><AssessmentIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="統計・予実管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
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
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifAnchor, setNotifAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', user.id).single();
        if (profile) {
          setUserName(profile.name);
          setAvatarUrl(profile.avatar_url);
        }

        const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false);
        setUnreadCount(count || 0);

        const channel = supabase.channel('notifications')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => {
            setUnreadCount(prev => prev + 1);
          })
          .subscribe();

        return () => { supabase.removeChannel(channel); };
      }
    };
    fetchUser();
  }, []);

  const handleNav = (path: string) => { router.push(path); if (onClose) onClose(); };
  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/'); };

  return (
    <Box sx={{
      height: 52,
      bgcolor: tokens.neutral.borderAlt,
      display: 'flex',
      alignItems: 'center',
      px: 1.5,
      flexShrink: 0,
      width: '100%'
    }}>
      <Avatar
        src={avatarUrl}
        sx={{ width: 32, height: 32, bgcolor: tokens.brand.primary, fontSize: '0.8rem', mr: 1.5 }}
      >
        {userName ? userName.slice(0, 1) : 'U'}
      </Avatar>

      <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
        <Typography variant="caption" fontWeight="bold" noWrap sx={{ display: 'block', color: tokens.text.strong, fontSize: '0.85rem' }}>
          {userName || 'アカウント'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }} noWrap>
          オンライン
        </Typography>
      </Box>

      <Tooltip title="通知">
        <IconButton size="small" onClick={(e) => setNotifAnchor(e.currentTarget)}>
          <Badge badgeContent={unreadCount} color="error" variant="dot">
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <NotificationsPopover anchorEl={notifAnchor} onClose={() => setNotifAnchor(null)} />

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
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: tokens.neutral.white }}>

      {isMobile && (
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, height: 48, bgcolor: tokens.neutral.surface, borderBottom: `1px solid ${tokens.neutral.border}`, display: 'flex', alignItems: 'center', px: 2, zIndex: 1200 }}>
          <IconButton edge="start" onClick={() => setMobileOpen(true)} size="small" sx={{ mr: 2 }}><MenuIcon /></IconButton>
          <Typography variant="subtitle1" fontWeight="bold" color={tokens.text.strong}>{currentOrg?.name || 'CareRecord'}</Typography>
        </Box>
      )}

      <Box sx={{
        width: RAIL_WIDTH + SIDEBAR_WIDTH,
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        height: '100%',
        bgcolor: tokens.neutral.border
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
          bgcolor: tokens.neutral.white,
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
'use client';

import { useState, useEffect } from 'react';
import {
  Box, Avatar, Tooltip, IconButton, Divider, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Drawer, useMediaQuery, Collapse, Badge, Popover, CircularProgress,
  Alert, AppBar, Toolbar, Button, Menu, MenuItem
} from '@/components/ui/mui';
import { useTheme, alpha, Theme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import TagIcon from '@mui/icons-material/Tag';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import PeopleIcon from '@mui/icons-material/People';
import BadgeIcon from '@mui/icons-material/Badge';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import LogoutIcon from '@mui/icons-material/Logout';
import BusinessIcon from '@mui/icons-material/Business';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AssessmentIcon from '@mui/icons-material/Assessment';
import KeyIcon from '@mui/icons-material/Key';
import BackupIcon from '@mui/icons-material/Backup';
import ListAltIcon from '@mui/icons-material/ListAlt';

import { useWorkspace, Workspace } from '@/context/WorkspaceContext';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { markNotificationRead } from '@/app/actions/user';
import { recordLogout } from '@/app/actions/auth';
import IdleTimeout from '@/components/auth/IdleTimeout';
import { checkManagementPermission, checkShiftPermission, type ManagementArea } from '@/utils/permissions';

const SIDEBAR_WIDTH = 256;
const SIDEBAR_COLLAPSED_WIDTH = 72;

const PROTECTED_MANAGEMENT_ROUTES: Array<{ prefix: string; area: ManagementArea }> = [
  { prefix: '/app/accounts', area: 'accounts' },
  { prefix: '/app/settings/roles', area: 'roles' },
  { prefix: '/app/clients', area: 'clients' },
  { prefix: '/app/staff', area: 'staffs' },
  { prefix: '/app/reports', area: 'reports' },
  { prefix: '/app/statistics', area: 'reports' },
  { prefix: '/app/logs', area: 'auditLogs' },
  { prefix: '/app/backup', area: 'auditLogs' },
];

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
      await markNotificationRead(n.id);
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
      slotProps={{ paper: { sx: { width: { xs: 'calc(100vw - 32px)', sm: 320 }, maxWidth: 320, maxHeight: 400 } } }}
    >
      <Box p={2} borderBottom="1px solid" borderColor="divider">
        <Typography fontWeight="bold">通知</Typography>
      </Box>
      {loading ? <Box p={2} textAlign="center"><CircularProgress size={20} /></Box> : (
        <List sx={{ p: 0 }}>
          {notifications.length === 0 && <Box p={2} textAlign="center" color="text.secondary">通知はありません</Box>}
          {notifications.map(n => (
            <ListItemButton key={n.id} onClick={() => handleRead(n)} sx={{ bgcolor: n.is_read ? 'background.paper' : 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
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

// 上部 AppBar：組織切替ドロップダウン・通知・アカウントメニューを集約（Google Workspace 風）
const TopAppBar = ({
  orgList, currentOrg, switchOrg, onMenuClick, showMenuButton
}: {
  orgList: Workspace[],
  currentOrg: Workspace | null,
  switchOrg: (id: string) => void,
  onMenuClick: () => void,
  showMenuButton: boolean
}) => {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);

  const [orgAnchor, setOrgAnchor] = useState<null | HTMLElement>(null);
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);
  const [notifAnchor, setNotifAnchor] = useState<null | HTMLElement>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('name, avatar_url').eq('id', user.id).maybeSingle();
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

  const handleSwitchOrg = (id: string) => {
    switchOrg(id);
    setOrgAnchor(null);
  };

  const handleLogout = async () => {
    setAccountAnchor(null);
    // 監査記録はサインアウト前（まだ認証済みのうち）に行う。
    await recordLogout();
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <AppBar position="static">
      <Toolbar sx={{ gap: { xs: 0.5, sm: 1 }, px: { xs: 1, sm: 2 } }}>
        {showMenuButton && (
          <IconButton edge="start" onClick={onMenuClick} sx={{ mr: 1 }} aria-label="メニューを開く">
            <MenuIcon />
          </IconButton>
        )}

        <Typography
          variant="h6"
          noWrap
          sx={{ fontWeight: 700, fontSize: '1.1rem', mr: 2, display: { xs: 'none', sm: 'block' } }}
        >
          CareRecord
        </Typography>

        {/* 組織切替ドロップダウン */}
        <Button
          onClick={(e) => setOrgAnchor(e.currentTarget)}
          startIcon={<BusinessIcon />}
          endIcon={<ExpandMore />}
          sx={{
            color: 'text.primary',
            textTransform: 'none',
            borderRadius: 2,
            px: { xs: 1, sm: 1.5 },
            minWidth: 0,
            maxWidth: { xs: 150, sm: 280 },
            '& .MuiButton-startIcon': { color: 'primary.main' }
          }}
        >
          <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {currentOrg?.name || '事業所を選択'}
          </Typography>
        </Button>
        <Menu
          anchorEl={orgAnchor}
          open={Boolean(orgAnchor)}
          onClose={() => setOrgAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { minWidth: 240 } } }}
        >
          {orgList.map(org => (
            <MenuItem
              key={org.id}
              selected={currentOrg?.id === org.id}
              onClick={() => handleSwitchOrg(org.id)}
            >
              <ListItemIcon>
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.85rem', bgcolor: currentOrg?.id === org.id ? 'primary.main' : 'background.muted', color: currentOrg?.id === org.id ? 'primary.contrastText' : 'text.secondary' }}>
                  {org.name.slice(0, 1)}
                </Avatar>
              </ListItemIcon>
              <ListItemText primary={org.name} primaryTypographyProps={{ noWrap: true }} />
            </MenuItem>
          ))}
          <Divider />
          <MenuItem onClick={() => { setOrgAnchor(null); router.push('/setup'); }}>
            <ListItemIcon><AddIcon fontSize="small" color="success" /></ListItemIcon>
            <ListItemText primary="事業所を追加 / 参加" />
          </MenuItem>
        </Menu>

        <Box sx={{ flexGrow: 1 }} />

        {/* 通知 */}
        <Tooltip title="通知">
          <IconButton onClick={(e) => setNotifAnchor(e.currentTarget)}>
            <Badge badgeContent={unreadCount} color="error" variant="dot">
              <NotificationsIcon />
            </Badge>
          </IconButton>
        </Tooltip>
        <NotificationsPopover anchorEl={notifAnchor} onClose={() => setNotifAnchor(null)} />

        {/* アカウントメニュー */}
        <Tooltip title="アカウント">
          <IconButton onClick={(e) => setAccountAnchor(e.currentTarget)} sx={{ ml: 0.5 }}>
            <Avatar src={avatarUrl} sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: '0.85rem' }}>
              {userName ? userName.slice(0, 1) : 'U'}
            </Avatar>
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={accountAnchor}
          open={Boolean(accountAnchor)}
          onClose={() => setAccountAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { minWidth: 220 } } }}
        >
          <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar src={avatarUrl} sx={{ width: 40, height: 40, bgcolor: 'primary.main' }}>
              {userName ? userName.slice(0, 1) : 'U'}
            </Avatar>
            <Box sx={{ overflow: 'hidden' }}>
              <Typography fontWeight="bold" fontSize="0.9rem" noWrap>{userName || 'アカウント'}</Typography>
            </Box>
          </Box>
          <Divider />
          <MenuItem onClick={() => { setAccountAnchor(null); router.push('/app/profile'); }}>
            <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="設定" />
          </MenuItem>
          <MenuItem onClick={handleLogout}>
            <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="ログアウト" />
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
};

// 左ナビゲーション（Google 風：白基調・丸ピルの選択スタイル）
const NavDrawer = ({
  currentOrg,
  onClose,
  sidebarOpen = true,
  onToggle,
}: {
  currentOrg: Workspace | null,
  onClose?: () => void,
  sidebarOpen?: boolean,
  onToggle?: () => void,
}) => {
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

  const isAdmin = Object.values(currentOrg.effectivePermissions.management).some(Boolean);
  const canViewShiftManagement = checkShiftPermission(currentOrg.effectivePermissions, 'view', true);

  const categoryStyle = {
    px: 3,
    pt: sidebarOpen ? 2.5 : 1,
    pb: sidebarOpen ? 1 : 0,
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'text.secondary',
    opacity: sidebarOpen ? 1 : 0,
    height: sidebarOpen ? 'auto' : 8,
    overflow: 'hidden',
    transition: 'opacity 0.2s ease, height 0.2s ease, padding 0.2s ease',
  };

  // Google（Gmail）風の丸ピル選択スタイル
  const itemStyle = (active: boolean) => ({
    mx: sidebarOpen ? 1.5 : 0.5,
    my: 0.25,
    borderRadius: '24px',
    justifyContent: sidebarOpen ? 'flex-start' : 'center',
    minHeight: 48,
    color: active ? 'primary.main' : 'text.primary',
    bgcolor: active ? (t: Theme) => alpha(t.palette.primary.main, 0.12) : 'transparent',
    fontWeight: active ? 600 : 500,
    '&:hover': {
      bgcolor: active ? (t: Theme) => alpha(t.palette.primary.main, 0.16) : 'action.hover'
    },
    '& .MuiListItemIcon-root': {
      color: active ? 'primary.main' : 'text.secondary',
      minWidth: sidebarOpen ? 36 : 0,
      justifyContent: 'center',
    }
  });

  const textProps = {
    sx: {
      opacity: sidebarOpen ? 1 : 0,
      width: sidebarOpen ? 'auto' : 0,
      whiteSpace: 'nowrap',
      transition: 'opacity 0.2s ease, width 0.2s ease',
    },
    primaryTypographyProps: { fontSize: '0.95rem' },
  };

  const navButton = (label: string, icon: React.ReactNode, path: string, queryCheck?: { key: string, val: string }) => {
    const activePath = path.split('?')[0];
    return (
    <ListItem disablePadding>
      <Tooltip title={sidebarOpen ? '' : label} placement="right" arrow>
        <ListItemButton onClick={() => handleNav(path)} sx={itemStyle(isActive(activePath, queryCheck))}>
          <ListItemIcon>{icon}</ListItemIcon>
          <ListItemText primary={label} {...textProps} />
        </ListItemButton>
      </Tooltip>
    </ListItem>
    );
  };

  return (
    <Box sx={{
      width: sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
      bgcolor: 'background.paper',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowX: 'hidden',
      overflowY: 'auto',
      transition: 'width 0.2s ease',
    }}>
      <Box sx={{ flexGrow: 1, py: 1 }}>
        <Typography sx={categoryStyle}>記録</Typography>
        <List disablePadding>
          {navButton('記録を作成', <EditNoteIcon fontSize="small" />, '/app/record')}
          {navButton('内勤を記録', <WorkHistoryIcon fontSize="small" />, '/app/internal-work')}
          {navButton('自分の履歴', <HistoryIcon fontSize="small" />, '/app/history')}
        </List>

        <Typography sx={categoryStyle}>シフト</Typography>
        <List disablePadding>
          {navButton('自分のシフト', <EditNoteIcon fontSize="small" />, '/app/shifts/my')}
          {canViewShiftManagement && (
            navButton('シフト管理', <CalendarMonthIcon fontSize="small" />, '/app/shifts/manage')
          )}
        </List>

        {isAdmin && (
          <>
            <Box onClick={() => sidebarOpen && setOpenReports(!openReports)} sx={{ ...categoryStyle, display: 'flex', alignItems: 'center', cursor: sidebarOpen ? 'pointer' : 'default', '&:hover': { color: 'text.primary' } }}>
              提供記録一覧
              {openReports ? <ExpandLess fontSize="small" sx={{ ml: 'auto' }} /> : <ExpandMore fontSize="small" sx={{ ml: 'auto' }} />}
            </Box>
            <Collapse in={sidebarOpen ? openReports : true} timeout="auto" unmountOnExit>
              <List disablePadding>
                {navButton('全件表示', <TagIcon fontSize="small" />, '/app/reports')}
                {navButton('未承認・差戻し', <WarningAmberIcon fontSize="small" color="warning" />, '/app/reports?status=unapproved', { key: 'status', val: 'unapproved' })}
                {navButton('今月の記録', <CalendarMonthIcon fontSize="small" />, '/app/reports?period=current_month', { key: 'period', val: 'current_month' })}
              </List>
            </Collapse>

            <Typography sx={categoryStyle}>管理</Typography>
            <List disablePadding>
              {isAdmin && (
                navButton('事業所設定', <BusinessIcon fontSize="small" />, '/app/settings')
              )}

              {navButton('利用者管理', <PeopleIcon fontSize="small" />, '/app/clients')}
              {navButton('スタッフ(名簿)管理', <BadgeIcon fontSize="small" />, '/app/staff')}

              {checkManagementPermission(currentOrg.effectivePermissions, 'accounts') && (
                navButton('アカウント・権限管理', <KeyIcon fontSize="small" />, '/app/accounts')
              )}
              {navButton('統計・予実管理', <AssessmentIcon fontSize="small" />, '/app/statistics')}
              {checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs') &&
                navButton('ログ', <ListAltIcon fontSize="small" />, '/app/logs')}
              {checkManagementPermission(currentOrg.effectivePermissions, 'auditLogs') &&
                navButton('バックアップ閲覧', <BackupIcon fontSize="small" />, '/app/backup')}
            </List>
          </>
        )}
      </Box>
      {onToggle && (
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1 }}>
          <Tooltip title={sidebarOpen ? 'サイドバーを折りたたむ' : 'サイドバーを展開'} placement="right" arrow>
            <IconButton onClick={onToggle} aria-label={sidebarOpen ? 'サイドバーを折りたたむ' : 'サイドバーを展開'} sx={{ width: '100%' }}>
              {sidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('care-record-sidebar-open');
    return stored === null ? true : stored === 'true';
  });
  const { orgList, currentOrg, switchOrg } = useWorkspace();
  const sidebarWidth = sidebarOpen ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;

  useEffect(() => {
    window.localStorage.setItem('care-record-sidebar-open', String(sidebarOpen));
  }, [sidebarOpen]);
  const matchedRoute = PROTECTED_MANAGEMENT_ROUTES.find(({ prefix }) => pathname.startsWith(prefix));
  const shiftAccessDenied = Boolean(
    currentOrg && pathname.startsWith('/app/shifts/manage') && !checkShiftPermission(currentOrg.effectivePermissions, 'view', true)
  );
  const accessDenied = Boolean(
    shiftAccessDenied || (currentOrg && matchedRoute && !(
      checkManagementPermission(currentOrg.effectivePermissions, matchedRoute.area)
    ))
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      <IdleTimeout />
      <TopAppBar
        orgList={orgList}
        currentOrg={currentOrg}
        switchOrg={switchOrg}
        onMenuClick={() => setMobileOpen(true)}
        showMenuButton={isMobile}
      />

      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        {/* デスクトップ：常時表示のナビ */}
        <Box sx={{
          width: sidebarWidth,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          borderRight: '1px solid',
          borderColor: 'divider',
          height: '100%',
          transition: 'width 0.2s ease',
        }}>
          <NavDrawer currentOrg={currentOrg} sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(v => !v)} />
        </Box>

        {/* モバイル：一時的なドロワー */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH } }}
        >
          <NavDrawer currentOrg={currentOrg} onClose={() => setMobileOpen(false)} />
        </Drawer>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {accessDenied ? (
            <Box maxWidth={560} mx="auto" mt={8} px={2} width="100%">
              <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => router.replace('/app')}>戻る</Button>}>
                この画面を表示する権限がありません。
              </Alert>
            </Box>
          ) : children}
        </Box>
      </Box>
    </Box>
  );
}

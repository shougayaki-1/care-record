'use client';

import { useState } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Collapse } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HistoryIcon from '@mui/icons-material/History';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TagIcon from '@mui/icons-material/Tag';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BusinessIcon from '@mui/icons-material/Business';
import PeopleIcon from '@mui/icons-material/People';
import BadgeIcon from '@mui/icons-material/Badge';
import KeyIcon from '@mui/icons-material/Key';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Workspace } from '@/context/WorkspaceContext';

const SIDEBAR_WIDTH = 240;

type Props = {
  currentOrg: Workspace | null;
  onClose?: () => void;
};

export const ChannelSidebar = ({ currentOrg, onClose }: Props) => {
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

        <Typography sx={categoryStyle}>シフト</Typography>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton onClick={() => handleNav('/app/shifts/manage')} sx={itemStyle(isActive('/app/shifts/manage'))}>
              <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="シフト管理" primaryTypographyProps={{ fontSize: '0.95rem' }} />
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
'use client';

import { useState } from 'react';
import { Box, IconButton, Drawer, useMediaQuery, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';

import { useWorkspace } from '@/context/WorkspaceContext';

// アクション4.1: 分離・モジュール化したコンポーネントを綺麗にインポート
import { ServerRail } from './ServerRail';
import { ChannelSidebar } from './ChannelSidebar';
import { UserPanel } from './UserPanel';

const RAIL_WIDTH = 72;
const SIDEBAR_WIDTH = 240;

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

      {/* デスクトップ用レイアウト */}
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

      {/* モバイル用レイアウト (Drawer) */}
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
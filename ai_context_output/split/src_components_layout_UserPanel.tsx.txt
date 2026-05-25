'use client';

import { useState, useEffect } from 'react';
import { Box, Avatar, Tooltip, IconButton, Badge, Typography } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { NotificationsPopover } from './NotificationsPopover';

type Props = {
  onClose?: () => void;
};

export const UserPanel = ({ onClose }: Props) => {
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

  const handleNav = (path: string) => { 
    router.push(path); 
    if (onClose) onClose(); 
  };
  
  const handleLogout = async () => { 
    await supabase.auth.signOut(); 
    router.push('/'); 
  };

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
      <Avatar
        src={avatarUrl}
        sx={{ width: 32, height: 32, bgcolor: '#2255CC', fontSize: '0.8rem', mr: 1.5 }}
      >
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
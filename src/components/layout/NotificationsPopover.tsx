'use client';

import { useState, useEffect } from 'react';
import { Box, Typography, List, ListItemButton, ListItemIcon, ListItemText, Popover, CircularProgress } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Notification = {
  id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  type: string;
  link_url?: string;
};

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
};

export const NotificationsPopover = ({ anchorEl, onClose }: Props) => {
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
            <ListItemButton key={n.id} onClick={() => handleRead(n)} sx={{ bgcolor: n.is_read ? 'white' : '#f0f7ff', borderBottom: '1px solid #f5f5f5' }}>
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
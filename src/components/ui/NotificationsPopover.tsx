'use client';

import { useId } from 'react';
import AssignmentLateOutlinedIcon from '@mui/icons-material/AssignmentLateOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { Box, CircularProgress, Fade, IconButton, List, ListItem, ListItemButton, Popover, Typography } from './mui';
import { getNotificationCategory, notificationCategoryLabels, type NotificationItem } from '@/lib/notifications/model';

export type NotificationsPopoverProps = {
  anchorEl: HTMLElement | null;
  notifications: NotificationItem[];
  loading: boolean;
  error?: string | null;
  pendingId?: string | null;
  onClose: () => void;
  onSelect: (notification: NotificationItem) => void;
};

export function NotificationsPopover({ anchorEl, notifications, loading, error, pendingId, onClose, onSelect }: NotificationsPopoverProps) {
  const titleId = useId();
  return (
    <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slots={{ transition: Fade }}
      slotProps={{ paper: { role: 'dialog', 'aria-labelledby': titleId, sx: {
        width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(400px, calc(100vh - 32px))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      } } }}>
      <Box sx={{ p: 1, pl: 2, display: 'flex', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography id={titleId} component="h2" fontWeight="bold" sx={{ flex: 1 }}>通知</Typography>
        <IconButton aria-label="通知を閉じる" onClick={onClose}><CloseIcon /></IconButton>
      </Box>
      <Box sx={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {error && <Typography role="alert" sx={{ p: 2, overflowWrap: 'anywhere' }}>{error}</Typography>}
      {loading ? <Box p={2} textAlign="center"><CircularProgress size={20} aria-label="通知を読み込み中" /></Box> : (
        <List aria-label="通知一覧" sx={{ p: 0 }}>
          {notifications.length === 0 && <ListItem><Typography color="text.secondary">通知はありません</Typography></ListItem>}
          {notifications.map(notification => {
            const category = getNotificationCategory(notification);
            const Icon = category === 'action_required' ? AssignmentLateOutlinedIcon : category === 'warning' ? WarningAmberIcon : InfoOutlinedIcon;
            return <ListItem key={notification.id} disablePadding>
              <ListItemButton component="button" type="button" disabled={pendingId === notification.id}
                onClick={() => onSelect(notification)} sx={{ width: '100%', minWidth: 0, textAlign: 'left', alignItems: 'flex-start', gap: 1,
                  bgcolor: notification.is_read ? 'background.paper' : 'background.tint', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Icon aria-hidden="true" fontSize="small" color={category === 'info' ? 'info' : 'warning'} sx={{ flexShrink: 0, mt: 0.25 }} />
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <Typography variant="caption" component="div">{notificationCategoryLabels[category]} · {notification.is_read ? '既読' : '未読'}</Typography>
                  {notification.title && <Typography component="div" variant="body2" fontWeight="bold">{notification.title}</Typography>}
                  <Typography component="div" variant="body2" fontWeight={notification.is_read ? 'normal' : 'bold'}>{notification.content}</Typography>
                  {notification.created_at && <Typography component="div" variant="caption" color="text.secondary">
                    {new Date(notification.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                  </Typography>}
                </Box>
              </ListItemButton>
            </ListItem>;
          })}
        </List>
      )}
      </Box>
    </Popover>
  );
}

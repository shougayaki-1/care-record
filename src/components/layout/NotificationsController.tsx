'use client';

import { readActionResult } from '@/utils/actionResult';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { markNotificationRead } from '@/app/actions/user';
import { NotificationsPopover } from '@/components/ui/NotificationsPopover';
import { getNotificationLink, type NotificationItem } from '@/lib/notifications/model';

export const NotificationsController = React.memo(function NotificationsController({ anchorEl, onClose, onRead, refreshKey }: {
  anchorEl: HTMLElement | null; onClose: () => void; onRead: () => void; refreshKey: number;
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!anchorEl) return;
    let cancelled = false;
    const fetchNotifications = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase.from('notifications')
          .select('*').order('created_at', { ascending: false }).limit(20);
        if (cancelled) return;
        if (fetchError) throw new Error('notification_fetch_failed');
        setNotifications(data || []);
      } catch {
        if (!cancelled) setError('通知を取得できませんでした。閉じてからもう一度お試しください。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchNotifications();
    return () => { cancelled = true; };
  }, [anchorEl, refreshKey]);

  const handleRead = async (notification: NotificationItem) => {
    if (pendingId) return;
    setPendingId(notification.id);
    setError(null);
    try {
      if (!notification.is_read) {
        const result = await readActionResult(markNotificationRead(notification.id));
        setNotifications(previous => previous.map(item => item.id === notification.id
          ? { ...item, is_read: true, read_at: result.readAt } : item));
        onRead();
      }
      const link = getNotificationLink(notification.link_url);
      if (link) {
        router.push(link);
        onClose();
      }
    } catch {
      setError('通知を既読にできませんでした。もう一度お試しください。');
    } finally {
      setPendingId(null);
    }
  };

  return <NotificationsPopover anchorEl={anchorEl} onClose={onClose} notifications={notifications}
    loading={loading} error={error} pendingId={pendingId} onSelect={handleRead} />;
});

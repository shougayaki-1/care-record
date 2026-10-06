import events from './events.json';

export type NotificationEventType = keyof typeof events;
export const notificationCategories = ['action_required', 'warning', 'info'] as const;
export type NotificationCategory = typeof notificationCategories[number];
export type NotificationPriority = 'normal' | 'high' | 'critical';
export const notificationCategoryLabels: Record<NotificationCategory, string> = {
  action_required: '要対応', warning: '警告', info: '情報',
};

export const notificationEvents = events;

/** Nullable extension fields preserve notifications written by the previous app. */
export type NotificationItem = {
  id: string;
  organization_id?: string | null;
  type: string;
  category?: string | null;
  title?: string | null;
  content: string;
  created_at: string | null;
  is_read: boolean | null;
  read_at?: string | null;
  link_url?: string | null;
};

export function getNotificationCategory(item: Pick<NotificationItem, 'category' | 'type'>): NotificationCategory {
  if (notificationCategories.some(category => category === item.category)) return item.category as NotificationCategory;
  return item.type === 'approve' ? 'info' : 'action_required';
}

/** Only application routes are navigable, including for legacy rows. */
export function getNotificationLink(link: string | null | undefined): string | null {
  if (!link || !/^\/app(?:\/|\?|$)/.test(link) || /[\\\u0000-\u0020]/.test(link)) return null;
  try {
    const url = new URL(link, 'https://notification.invalid');
    return url.origin === 'https://notification.invalid' && (url.pathname === '/app' || url.pathname.startsWith('/app/')) ? link : null;
  } catch {
    return null;
  }
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getNotificationCategory, getNotificationLink, notificationCategories, notificationEvents } from './model';

describe('notification display contract', () => {
  it('preserves legacy classification and prefers the common category', () => {
    expect(getNotificationCategory({ type: 'approve' })).toBe('info');
    expect(getNotificationCategory({ type: 'remand', category: null })).toBe('action_required');
    expect(getNotificationCategory({ type: 'approve', category: 'warning' })).toBe('warning');
  });
  it.each(['javascript:alert(1)', '//evil.invalid/app', '/app\\evil', '/app/../../outside', 'https://evil.invalid/app', '/application'])('rejects unsafe legacy links: %s', link => {
    expect(getNotificationLink(link)).toBeNull();
  });
  it('allows existing application routes and missing destinations', () => {
    expect(getNotificationLink('/app/reports?id=example')).toBe('/app/reports?id=example');
    expect(getNotificationLink(null)).toBeNull();
  });
  it('classifies new shift assignments as info and schedule disruption as action required', () => {
    expect(notificationEvents['shift.assigned'].category).toBe('info');
    for (const event of ['shift.unassigned', 'shift.time_changed', 'shift.cancelled', 'shift.reopened'] as const) {
      expect(notificationEvents[event].category).toBe('action_required');
      expect(notificationEvents[event].linkUrl).toBe('/app/shifts/my');
    }
  });
  it('uses the same fixed templates in the DB and application', () => {
    const sql = readFileSync('supabase/migrations/20261007000002_shift_business_notifications.sql', 'utf8');
    const template = sql.split('$notification_templates$')[1];
    expect(JSON.parse(template)).toEqual(notificationEvents);
    expect(Object.keys(notificationEvents)).toHaveLength(15);
    for (const event of Object.values(notificationEvents)) {
      expect(notificationCategories).toContain(event.category);
      expect(['normal', 'high', 'critical']).toContain(event.priority);
      expect(event.title).toBeTruthy();
      expect(event.content).toBeTruthy();
      if (event.linkUrl) expect(getNotificationLink(event.linkUrl)).toBe(event.linkUrl);
    }
  });
});

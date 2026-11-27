// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/app/actions/mcpBusinessAlerts', () => ({ getBusinessAlertPreferences: mocks.get, setBusinessAlertPreferences: mocks.set }));
import { BusinessAlertSettings } from './BusinessAlertSettings';
const initial = { enabled: false, frequency: 'daily', pending_reports: false, unassigned_shifts: false };
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ ok: true, data: initial }); });
afterEach(cleanup);
it('lets the recipient select and save only their own alert preferences', async () => {
  mocks.set.mockResolvedValue({ ok: true, data: { ...initial, enabled: true, pending_reports: true } });
  await act(async () => { render(<BusinessAlertSettings organizationId="org" organizationName="事業所 A" />); });
  expect(await screen.findByText(/事業所: 事業所 A/)).toBeTruthy();
  fireEvent.click(screen.getByRole('switch', { name: '業務通知を受け取る' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '未承認の記録' }));
  fireEvent.click(screen.getByRole('button', { name: '通知設定を保存' }));
  expect(await screen.findByText('通知設定を保存しました。')).toBeTruthy();
  expect(mocks.set).toHaveBeenCalledWith('org', { ...initial, enabled: true, pending_reports: true });
});
it('allows alerts to be stopped', async () => {
  mocks.get.mockResolvedValue({ ok: true, data: { ...initial, enabled: true, pending_reports: true } });
  mocks.set.mockResolvedValue({ ok: true, data: { ...initial, pending_reports: true } });
  await act(async () => { render(<BusinessAlertSettings organizationId="org" organizationName="事業所 A" />); });
  fireEvent.click(await screen.findByRole('switch', { name: '業務通知を受け取る' }));
  fireEvent.click(screen.getByRole('button', { name: '通知設定を保存' }));
  expect(await screen.findByText('通知設定を保存しました。')).toBeTruthy();
  expect(mocks.set).toHaveBeenCalledWith('org', { ...initial, pending_reports: true });
});

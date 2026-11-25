import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { GoogleIntegrationSettings } from './GoogleIntegrationSettings';

const meta = {
  title: 'Settings/GoogleIntegration', component: GoogleIntegrationSettings,
  args: {
    orgName: '合成事業所', googleFolderId: null, googleCalendarId: null, googleConnectionState: 'healthy', driveUrl: 'https://example.invalid',
    canManageIntegrations: true, canRepairCalendarSync: true, connecting: false, connectingCal: false, repairingCal: false, resyncingCal: false,
    syncStatus: null, syncProgress: null, handleConnectDrive: fn(), handleDisconnectDrive: fn(), handleConnectCalendar: fn(),
    handleDisconnectCalendar: fn(), handleRepairCalendar: fn(), handleForceResyncCalendar: fn(),
  },
} satisfies Meta<typeof GoogleIntegrationSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unconnected: Story = { play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  const connect = canvas.getByRole('button', { name: 'シフト用カレンダーを作成・連携する' });
  await expect(connect).toHaveClass('MuiButton-colorPrimary');
  await userEvent.click(connect);
  await expect(args.handleConnectCalendar).toHaveBeenCalledOnce();
} };

export const Connected: Story = { args: { googleFolderId: 'synthetic-folder', googleCalendarId: 'synthetic-calendar', syncStatus: { total: 2, unsynced: 0 } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText('すべての予定（2 件）がGoogleカレンダーと同期済みです。')).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Googleを再認証' })).toHaveClass('MuiButton-colorSecondary');
} };

export const Attention: Story = { args: { googleCalendarId: 'synthetic-calendar', googleConnectionState: 'reauth_required', syncStatus: { total: 2, unsynced: 1 } }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(/未同期の予定が/)).toBeVisible();
  await expect(canvas.getByRole('button', { name: /未同期を同期/ })).toBeEnabled();
} };

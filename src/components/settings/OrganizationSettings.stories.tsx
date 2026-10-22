import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { OrganizationBasics } from './OrganizationBasics';
import { OrganizationDangerSettings } from './OrganizationDangerSettings';
import { GoogleIntegrationSettings } from './GoogleIntegrationSettings';

const meta = {
  title: 'Settings/OrganizationSections',
  component: GoogleIntegrationSettings,
  parameters: { layout: 'padded' },
  args: {
    orgName: 'サンプル事業所', googleFolderId: null, googleCalendarId: null,
    googleConnectionState: 'disconnected', driveUrl: '', canManageIntegrations: true,
    canRepairCalendarSync: true, connecting: false, connectingCal: false,
    repairingCal: false, resyncingCal: false, syncStatus: null, syncProgress: null,
    handleConnectDrive: fn(), handleDisconnectDrive: fn(), handleConnectCalendar: fn(),
    handleDisconnectCalendar: fn(), handleRepairCalendar: fn(), handleForceResyncCalendar: fn(),
  },
} satisfies Meta<typeof GoogleIntegrationSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '連携フォルダを作成する' }));
    await expect(args.handleConnectDrive).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'シフト用カレンダーを作成・連携する' }));
    await expect(args.handleConnectCalendar).toHaveBeenCalled();
  },
};
export const Connected: Story = {
  args: { googleFolderId: 'sample-folder', googleCalendarId: 'sample-calendar', googleConnectionState: 'healthy', driveUrl: 'https://example.invalid/folder', syncStatus: { total: 3, unsynced: 2 } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /未同期を同期/ }));
    await expect(args.handleRepairCalendar).toHaveBeenCalled();
    await expect(canvas.getByRole('link', { name: 'フォルダを開く' })).toHaveAttribute('rel', 'noreferrer');
  },
};
export const Syncing: Story = {
  args: { googleCalendarId: 'sample-calendar', googleConnectionState: 'healthy', repairingCal: true, syncProgress: { total: 3, current: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '同期中...' })).toBeDisabled();
    await expect(canvas.getByRole('progressbar', { name: 'Googleカレンダー同期の進捗' })).toHaveAttribute('aria-valuenow', '33');
    await expect(canvas.getByRole('button', { name: '同期を修復' })).toBeDisabled();
  },
};
export const ReadOnlyIntegrations: Story = {
  args: { canManageIntegrations: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument();
  },
};
export const BasicSettings: Story = {
  render: () => <OrganizationBasics orgName="サンプル事業所" setOrgName={fn()} canEditOrganization saving={false} handleSave={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: '事業所名' })).toHaveValue('サンプル事業所');
    await expect(canvas.getByRole('button', { name: '変更を保存' })).toBeEnabled();
  },
};
export const BasicReadOnly: Story = {
  render: () => <OrganizationBasics orgName="サンプル事業所" setOrgName={fn()} canEditOrganization={false} saving={false} handleSave={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: '事業所名' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: '変更を保存' })).not.toBeInTheDocument();
  },
};
export const DangerOwner: Story = {
  render: () => <OrganizationDangerSettings canDeleteOrganization onLeave={fn()} onDelete={fn()} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '削除する' })).toBeVisible();
  },
};
export const DangerMember: Story = {
  render: () => <OrganizationDangerSettings canDeleteOrganization={false} onLeave={fn()} onDelete={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '脱退する' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument();
  },
};

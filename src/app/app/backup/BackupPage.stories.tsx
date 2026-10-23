import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, mocked, userEvent, within } from 'storybook/test';
import { getBackupRecords, getLastBackupRun, listDailyBackups } from '@/app/actions/backup';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FULL_PERMISSIONS } from '@/utils/permissions';
import { ToastProvider } from '@/components/ui/ToastProvider';
import BackupPage from './page';

const meta = {
  title: 'Pages/Backup', component: BackupPage,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <ToastProvider><Story /></ToastProvider>],
  beforeEach: () => {
    const org = { id: 'fixture-org', name: 'テスト事業所', role: 'owner' as const, effectivePermissions: FULL_PERMISSIONS };
    mocked(useWorkspace).mockReturnValue({ currentOrg: org, orgList: [org], loading: false, status: 'ready', errorMessage: null, userId: 'fixture-user', switchOrg: () => {}, refreshWorkspace: async () => {} });
    mocked(listDailyBackups).mockResolvedValue({ ok: true, data: { configured: true, files: [] } });
    mocked(getBackupRecords).mockResolvedValue({ ok: true, data: [] });
    mocked(getLastBackupRun).mockResolvedValue({ ok: true, data: null });
  },
} satisfies Meta<typeof BackupPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoExecution: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent('実行記録がありません');
  },
};
export const ExecutionReadFailure: Story = {
  beforeEach: () => {
    mocked(getLastBackupRun).mockResolvedValue({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: '最終実行情報を取得できませんでした' } });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('最終実行情報を取得できませんでした');
    await expect(canvas.queryByText(/実行記録がありません/)).not.toBeInTheDocument();
    mocked(getLastBackupRun).mockResolvedValue({ ok: true, data: null });
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(await canvas.findByText(/実行記録がありません/)).toBeVisible();
  },
};
export const OldExecution: Story = {
  beforeEach: () => {
    mocked(getLastBackupRun).mockResolvedValue({ ok: true, data: { createdAt: '2020-01-01T00:00:00Z', outcome: 'success', details: null } });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('最終実行から30時間以上経過しています');
    await expect(canvas.queryByText(/実行記録がありません/)).not.toBeInTheDocument();
  },
};
export const ListReadFailure: Story = {
  beforeEach: () => {
    mocked(listDailyBackups).mockResolvedValue({ ok: false, error: { code: 'UNEXPECTED_ERROR', message: 'バックアップ一覧を取得できませんでした' } });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('バックアップ一覧を取得できませんでした')).toBeVisible();
    mocked(listDailyBackups).mockResolvedValue({ ok: true, data: { configured: true, files: [] } });
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(await canvas.findByText('バックアップがありません')).toBeVisible();
  },
};

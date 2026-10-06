import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, mocked, userEvent, waitFor, within } from 'storybook/test';
import { getServiceTypes } from '@/app/actions/serviceTypes';
import ServiceTypeSettings from './ServiceTypeSettings';

const meta = {
  title: 'Settings/ServiceTypeSettings', component: ServiceTypeSettings,
  args: { orgId: 'fixture-org' },
  beforeEach: () => { mocked(getServiceTypes).mockResolvedValue({ ok: true, data: [] }); },
} satisfies Meta<typeof ServiceTypeSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getAllByText('設定なし').some(element => element.checkVisibility())).toBe(true));
  },
};
export const DeniedRead: Story = {
  beforeEach: () => { mocked(getServiceTypes).mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'この事業所へのアクセス権がありません' } }); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('この事業所へのアクセス権がありません');
    await expect(canvas.queryByText('設定なし')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'ログアウトしてやり直す' })).not.toBeInTheDocument();
    mocked(getServiceTypes).mockResolvedValue({ ok: true, data: [] });
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument());
    await expect(canvas.getAllByText('設定なし').some(element => element.checkVisibility())).toBe(true);
  },
};

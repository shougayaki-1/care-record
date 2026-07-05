import type { Meta, StoryObj } from '@storybook/react';
import OfficeManagementPanel from './OfficeManagementPanel';

const meta: Meta<typeof OfficeManagementPanel> = {
  title: 'Settings/OfficeManagementPanel',
  component: OfficeManagementPanel,
};
export default meta;

type Story = StoryObj<typeof OfficeManagementPanel>;

export const Default: Story = {
  args: {
    orgId: 'org-1',
    initialOffices: [
      { id: 'o1', organization_id: 'org-1', name: '本社', travel_cost_rate_yen_per_km: 20, archived_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'o2', organization_id: 'org-1', name: '第二事業所', travel_cost_rate_yen_per_km: 25, archived_at: null, created_at: '2026-01-02T00:00:00Z' },
    ],
  },
};

export const Empty: Story = {
  args: { orgId: 'org-1', initialOffices: [] },
};

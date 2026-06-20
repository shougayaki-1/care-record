import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SaveIcon from '@mui/icons-material/Save';
import { Stack } from '@mui/material';
import { AppButton } from './AppButton';

const meta = { title: 'UI/AppButton', component: AppButton, tags: ['autodocs'], args: { children: '保存する' } } satisfies Meta<typeof AppButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Disabled: Story = { args: { disabled: true } };
export const WithIcon: Story = { args: { startIcon: <SaveIcon /> } };
export const Intents: Story = {
  render: () => <Stack direction="row" spacing={1}>{(['primary', 'secondary', 'success', 'warning', 'danger'] as const).map((intent) => <AppButton key={intent} intent={intent}>{intent}</AppButton>)}</Stack>,
};


import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { RecoveryError } from './RecoveryError';

const meta = {
  title: 'Auth/RecoveryError',
  component: RecoveryError,
  tags: ['autodocs'],
  args: { error: new Error('Runtime failure'), retry: fn(), boundary: 'segment' },
} satisfies Meta<typeof RecoveryError>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Segment: Story = {};
export const Global: Story = { args: { boundary: 'global' } };
export const ChunkFailure: Story = { args: { error: new Error('Loading chunk failed') } };

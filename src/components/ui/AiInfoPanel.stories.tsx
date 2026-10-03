import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AiInfoPanel } from './AiInfoPanel';

function mockDestination(provider: 'gemini' | 'openai' | null) {
  const original = globalThis.fetch;
  globalThis.fetch = fn(async () => provider
    ? Response.json({ provider, model: provider === 'openai' ? 'gpt-6-luna' : 'gemini-test' })
    : new Response(null, { status: 503 }));
  return () => { globalThis.fetch = original; };
}

const meta = {
  title: 'UI/AiInfoPanel',
  component: AiInfoPanel,
  tags: ['autodocs'],
  beforeEach: () => mockDestination('gemini'),
} satisfies Meta<typeof AiInfoPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Gemini: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Google Vertex AI（gemini-test）/)).toBeVisible();
  },
};
export const OpenAI: Story = {
  beforeEach: () => mockDestination('openai'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/OpenAI（gpt-6-luna）/)).toBeVisible();
  },
};
export const Unavailable: Story = {
  beforeEach: () => mockDestination(null),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/送信先のAIサービスを表示できません/)).toBeVisible();
  },
};

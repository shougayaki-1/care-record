import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { RecordDynamicSections } from './RecordDynamicSections';

const meta = {
  title: 'Record/RecordDynamicSections', component: RecordDynamicSections,
  args: {
    sections: [{ title: '記録', items: [
      { id: 'ai', label: 'AI入力項目', type: 'text', required: false },
      { id: 'warning', label: '警告項目', type: 'text', required: false },
    ] }],
    answers: { ai: '合成データ', warning: '合成データ' }, errors: {}, warnings: { warning: '内容を確認してください' },
    aiFilledFields: new Set(['ai']), disabled: false, onAnswerChange: fn(),
  },
} satisfies Meta<typeof RecordDynamicSections>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AiAndWarning: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('AI入力済み・要確認')).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent('内容を確認してください');
  },
};

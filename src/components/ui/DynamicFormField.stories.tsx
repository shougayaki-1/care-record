import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DynamicFormField } from './DynamicFormField';

const meta = {
  title: 'UI/DynamicFormField',
  component: DynamicFormField,
  args: { onChange: fn(), onDetailChange: fn() },
} satisfies Meta<typeof DynamicFormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = { args: { item: { id: 'note', label: '特記事項', type: 'text', required: true }, value: '' } };
export const Error: Story = { args: { item: { id: 'amount', label: '排尿量', type: 'number', required: true }, value: '', error: '入力してください' } };
export const MultipleChoice: Story = {
  args: { item: { id: 'meal', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,その他', hasDetail: true }, value: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('朝'));
    await expect(args.onChange).toHaveBeenCalledWith(['朝']);
  },
};
export const Disabled: Story = { args: { item: { id: 'done', label: '実施済み', type: 'checkbox' }, value: true, disabled: true } };

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DynamicFormField, type DynamicFormItem, type DynamicFormValue } from './DynamicFormField';

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

// Interactive detail-field visibility stories: DynamicFormField is a
// controlled component, so each story wraps it in local state to exercise
// the real user flow of answering the main question and observing the
// detail field appear/disappear via shouldShowDetailInput().
function ControlledField({ item, initialValue }: { item: DynamicFormItem; initialValue: DynamicFormValue | undefined }) {
  const [value, setValue] = useState<DynamicFormValue | undefined>(initialValue);
  const [detailValue, setDetailValue] = useState('');
  return (
    <DynamicFormField
      item={item}
      value={value}
      detailValue={detailValue}
      onChange={setValue}
      onDetailChange={setDetailValue}
    />
  );
}

export const CheckboxDetailToggles: Story = {
  args: { item: { id: 'excretion', label: '排泄介助', type: 'checkbox', hasDetail: true, detailMode: 'conditional' }, value: false },
  render: (args) => <ControlledField item={args.item} initialValue={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByLabelText('詳細・補足')).toBeNull();
    await userEvent.click(canvas.getByLabelText('排泄介助'));
    await expect(canvas.getByLabelText('詳細・補足')).toBeInTheDocument();
  },
};

export const MultiCheckboxDetailWithoutOtherOption: Story = {
  // NOTE: options intentionally contain no "他" substring — this proves the
  // old option-text special case is gone and detail visibility is driven
  // purely by shouldShowDetailInput().
  args: { item: { id: 'meal_no_other', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩', hasDetail: true, detailMode: 'conditional' }, value: [] },
  render: (args) => <ControlledField item={args.item} initialValue={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByLabelText('詳細・補足')).toBeNull();
    await userEvent.click(canvas.getByLabelText('朝'));
    await expect(canvas.getByLabelText('詳細・補足')).toBeInTheDocument();
  },
};

export const AlwaysModeShowsDetailUpfront: Story = {
  args: { item: { id: 'urine', label: '排尿：尿破棄 (ml)', type: 'number', hasDetail: true, detailMode: 'always' }, value: undefined },
  render: (args) => <ControlledField item={args.item} initialValue={undefined} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('詳細・補足')).toBeInTheDocument();
  },
};

export const TextDetailAppearsOnInput: Story = {
  args: { item: { id: 'note2', label: '特記事項', type: 'text', hasDetail: true, detailMode: 'conditional' }, value: '' },
  render: (args) => <ControlledField item={args.item} initialValue="" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByLabelText('詳細・補足')).toBeNull();
    await userEvent.type(canvas.getByLabelText('特記事項'), '記録あり');
    await expect(canvas.getByLabelText('詳細・補足')).toBeInTheDocument();
  },
};

export const CustomDetailLabel: Story = {
  args: { item: { id: 'urine2', label: '排尿：尿破棄 (ml)', type: 'number', hasDetail: true, detailMode: 'always', detailLabel: '補足（色・状態など）' }, value: undefined },
  render: (args) => <ControlledField item={args.item} initialValue={undefined} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('補足（色・状態など）')).toBeInTheDocument();
    expect(canvas.queryByLabelText('詳細・補足')).toBeNull();
  },
};

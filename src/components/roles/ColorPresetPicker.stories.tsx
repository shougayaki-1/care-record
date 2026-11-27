import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { getContrastRatio } from '@mui/material/styles';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import ColorPresetPicker from './ColorPresetPicker';

const meta = {
  title: 'Roles/ColorPresetPicker', component: ColorPresetPicker,
  args: { value: '#EF4444', onChange: () => {} },
  render: function Picker(args) {
    const [value, setValue] = useState(args.value);
    return <ColorPresetPicker value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof ColorPresetPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KeyboardAndContrast: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('radiogroup', { name: 'ロールの色' });
    const red = within(group).getByRole('radio', { name: 'レッド' });
    await expect(red).toBeChecked();
    await userEvent.tab();
    await expect(red).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(within(group).getByRole('radio', { name: 'オレンジ' })).toBeChecked();
    for (const label of ['レッド', 'オレンジ', 'アンバー', 'イエロー', 'ライム', 'グリーン', 'ティール', 'シアン', 'ブルー', 'インディゴ', 'パープル', 'ピンク']) {
      const radio = within(group).getByRole('radio', { name: label });
      await userEvent.click(radio);
      await expect(radio).toBeChecked();
      const icon = radio.closest('.MuiRadio-root')?.querySelector('svg');
      if (!icon?.parentElement) throw new Error('選択マークが見つかりません');
      await expect(getContrastRatio(getComputedStyle(icon).color, getComputedStyle(icon.parentElement).backgroundColor)).toBeGreaterThanOrEqual(3);
    }
  },
};

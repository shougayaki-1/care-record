import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Stack, TextField } from '@mui/material';
import { expect, within } from 'storybook/test';
import { UnitAdornment } from './UnitAdornment';

const meta = { title: 'UI/UnitAdornment', component: UnitAdornment, args: { children: '時間' } } satisfies Meta<typeof UnitAdornment>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NarrowFields: Story = {
  render: () => (
    <Stack spacing={2} sx={{ width: 120 }}>
      <TextField label="提供時間" type="number" defaultValue="1.5" slotProps={{ input: { endAdornment: <UnitAdornment>時間</UnitAdornment> } }} />
      <TextField label="交通費" type="number" defaultValue="500" slotProps={{ input: { endAdornment: <UnitAdornment>円</UnitAdornment> } }} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const unit of ['時間', '円']) {
      const label = canvas.getByText(unit);
      const adornment = label.closest('.MuiInputAdornment-positionEnd');
      await expect(adornment).not.toBeNull();
      await expect(getComputedStyle(adornment!).whiteSpace).toBe('nowrap');
      await expect(getComputedStyle(adornment!).flexShrink).toBe('0');
      const range = document.createRange();
      range.selectNodeContents(label);
      await expect(new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size).toBe(1);
    }
  },
};

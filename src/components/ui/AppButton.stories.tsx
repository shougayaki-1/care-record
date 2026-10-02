import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SaveIcon from '@mui/icons-material/Save';
import { Box, Button, Stack } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import SendIcon from '@mui/icons-material/Send';
import { expect, within } from 'storybook/test';
import { InnerPageHeader, ScrollableActions } from './Layout';
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


const recordActions = (
  <ScrollableActions aria-label="記録操作" role="group" tabIndex={0}>
    <Button variant="contained" color="success" size="small" startIcon={<CheckCircleIcon />}>承認</Button>
    <AppButton intent="warning" size="small" startIcon={<AssignmentReturnIcon />}>承認取消</AppButton>
    <Button variant="outlined" size="small" startIcon={<SaveIcon />}>変更を保存</Button>
    <AppButton variant="outlined" size="small" startIcon={<SaveIcon />}>下書き</AppButton>
    <AppButton size="small" startIcon={<SendIcon />}>送信</AppButton>
  </ScrollableActions>
);

function recordHeaderStory(width: number): Story {
  return {
    parameters: { layout: 'fullscreen' },
    render: () => <Box sx={{ width, maxWidth: '100%' }}><InnerPageHeader title="記録の確認・承認" actions={recordActions} /></Box>,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const row = canvas.getByRole('group', { name: '記録操作' });
      const buttons = canvas.getAllByRole('button');
      for (const button of buttons) {
        await expect(getComputedStyle(button).whiteSpace).toBe('nowrap');
        await expect(getComputedStyle(button).flexShrink).toBe('0');
        // Measure the actual label, excluding the icon, to catch Japanese line breaks.
        for (const node of button.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const tops = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
          await expect(tops.size).toBe(1);
        }
        await expect(button.getBoundingClientRect().height).toBeLessThanOrEqual(36);
      }
      await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
      if (width <= 375) {
        await expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
        await expect(buttons[0].getBoundingClientRect().left).toBeGreaterThanOrEqual(row.getBoundingClientRect().left - 1);
        row.scrollLeft = row.scrollWidth;
        await expect(row.scrollLeft).toBeGreaterThan(0);
        await expect(buttons.at(-1)!.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 1);
        row.scrollLeft = 0;
      } else {
        await expect(row.scrollWidth).toBe(row.clientWidth);
      }
    },
  };
}

export const RecordHeader240: Story = recordHeaderStory(240);
export const RecordHeader320: Story = recordHeaderStory(320);
export const RecordHeader375: Story = recordHeaderStory(375);
export const RecordHeaderDesktop: Story = recordHeaderStory(1280);

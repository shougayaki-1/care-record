import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Box, Stack, Typography } from '@mui/material';
import { expect, fn, within } from 'storybook/test';
import { AppButton } from './AppButton';
import { DateTimeField, NumberField, AppTextField } from './Fields';
import { PageLayout, SectionCard } from './Layout';
import { UnitAdornment } from './UnitAdornment';
import { RecordFormHeader, RecordFormBody, RecordFormDialog } from './RecordFormLayout';

const meta = { title: 'UI/RecordFormLayout', component: RecordFormDialog, args: { open: true, title: '記録の確認・承認', onClose: fn() }, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof RecordFormDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
const actions = <><AppButton size="small" intent="secondary" variant="text">キャンセル</AppButton><AppButton size="small">原本と照合して確認済みにする</AppButton></>;
const fields = <>
  <SectionCard><Typography component="h3" variant="subtitle2" gutterBottom>基本情報</Typography><AppTextField label="件名" defaultValue="会議" /></SectionCard>
  <SectionCard><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><DateTimeField label="開始日時" defaultValue="2026-10-02T09:00" /><DateTimeField label="終了日時" defaultValue="2026-10-02T10:00" /></Stack></SectionCard>
  <SectionCard><NumberField label="時間" value="1" onChange={fn()} slotProps={{ input: { endAdornment: <UnitAdornment>時間</UnitAdornment> } }} /></SectionCard>
  <SectionCard><AppTextField label="メモ" multiline minRows={25} /></SectionCard>
</>;
export const Dialog: Story = {
  args: { actions, children: fields },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: '記録の確認・承認' });
    const group = within(dialog).getByRole('group', { name: '記録操作' });
    await expect(group.closest('.MuiDialogActions-root')).toBeNull();
    const body = dialog.querySelector('.MuiDialogContent-root')!.firstElementChild as HTMLElement;
    const before = group.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    await expect(group.getBoundingClientRect().top).toBe(before);
    await expect(body.scrollTop).toBeGreaterThan(0);
    await expect(dialog.scrollWidth).toBe(dialog.clientWidth);
  },
};
export const Processing: Story = { args: { actions: <AppButton loading size="small">保存</AppButton>, children: fields, loading: true } };
export const Page: Story = { args: { children: fields }, render: (args) => <Box sx={{ height: 600 }}><PageLayout><RecordFormHeader title={args.title} onClose={args.onClose} actions={actions} /><RecordFormBody>{fields}</RecordFormBody></PageLayout></Box> };

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import createCache, { type EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { AppButton } from './AppButton';
import { NotificationsPopover } from './NotificationsPopover';
import type { NotificationItem } from '@/lib/notifications/model';
import { CssBaseline, ThemeProvider } from './mui';
import theme from '@/theme';

const notifications: NotificationItem[] = [
  { id: 'action', type: 'report.remanded', category: 'action_required', title: '記録が差し戻されました', content: '内容を確認して修正してください。', is_read: false, created_at: '2026-10-04T00:00:00Z' },
  { id: 'warning', type: 'backup.failed', category: 'warning', title: 'バックアップに失敗しました', content: 'バックアップの状態を確認してください。', is_read: false, created_at: '2026-10-04T00:00:00Z' },
  { id: 'legacy', type: 'approve', content: '承認されました。', is_read: true, created_at: '2026-10-04T00:00:00Z' },
  { id: 'long', type: 'legacy', content: 'long-unbroken-legacy-notification-text'.repeat(5), is_read: false, created_at: null },
];
const onSelect = fn();
function Showcase({ error, items = notifications }: { error?: string; items?: NotificationItem[] }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return <><AppButton onClick={event => setAnchorEl(event.currentTarget)}>通知を開く</AppButton>
    <NotificationsPopover anchorEl={anchorEl} onClose={() => setAnchorEl(null)} notifications={items} loading={false} error={error} onSelect={onSelect} /></>;
}

const screenWidths = [240, 320, 375, 1280];

// Each iframe is a real viewport for vw units and Popover's ownerWindow. This
// avoids resizing the shared Vitest runner and works in ordinary Storybook too.
function WidthFrame({ width }: { width: number }) {
  const [target, setTarget] = useState<{ document: Document; cache: EmotionCache } | null>(null);
  return <>
    <iframe title={`通知 ${width}px`} data-testid={`notifications-width-${width}`}
      srcDoc="<!doctype html><html lang='ja'><head><title>通知</title></head><body></body></html>"
      style={{ display: 'block', width, height: 800, border: 0 }}
      onLoad={event => {
        const document = event.currentTarget.contentDocument;
        if (!document) throw new Error('通知の検証フレームを読み込めません');
        setTarget({ document, cache: createCache({ key: 'notification-frame', container: document.head }) });
      }} />
    {target && createPortal(
      <CacheProvider value={target.cache}><ThemeProvider theme={theme}>
        <CssBaseline /><Showcase />
      </ThemeProvider></CacheProvider>, target.document.body,
    )}
  </>;
}
const meta = { title: 'UI/NotificationsPopover', component: Showcase, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Showcase>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Categories: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '通知を開く' }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog', { name: '通知' });
    await waitFor(() => expect(within(dialog).getAllByText('要対応 · 未読')[0]).toBeVisible());
    await expect(within(dialog).getByText('警告 · 未読')).toBeVisible();
    await expect(within(dialog).getByText('情報 · 既読')).toBeVisible();
    const first = within(dialog).getByRole('button', { name: /記録が差し戻されました/ });
    first.focus();
    await userEvent.keyboard('{Enter}');
    await expect(onSelect).toHaveBeenCalledWith(notifications[0]);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(canvasElement).getByRole('button', { name: '通知を開く' })).toHaveFocus());
  },
};

export const ScreenWidths: Story = {
  render: () => <>{screenWidths.map(width => <WidthFrame key={width} width={width} />)}</>,
  play: async ({ canvasElement }) => {
      for (const width of screenWidths) {
        const frame = within(canvasElement).getByTestId(`notifications-width-${width}`) as HTMLIFrameElement;
        // Resolve after srcDoc navigation and the React portal are both ready.
        await waitFor(() => expect(within(frame.contentDocument!.body).getByRole('button', { name: '通知を開く' })).toBeVisible());
        const document = frame.contentDocument!;
        const frameWindow = frame.contentWindow!;
        const frameCanvas = within(document.body);
        const frameUser = userEvent.setup({ document });
        await expect(frameWindow.innerWidth).toBe(width);
        await frameUser.click(frameCanvas.getByRole('button', { name: '通知を開く' }));
        const dialog = await frameCanvas.findByRole('dialog', { name: '通知' });
        // Measure the displayed panel, after its opacity transition completes.
        await waitFor(() => expect(frameWindow.getComputedStyle(dialog).opacity).toBe('1'));
        await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        const bounds = dialog.getBoundingClientRect();
        await expect(bounds.left).toBeGreaterThanOrEqual(0);
        await expect(bounds.right).toBeLessThanOrEqual(width);
        for (const button of within(dialog).getAllByRole('button')) {
          const rect = button.getBoundingClientRect();
          await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
          await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
          await expect(rect.right).toBeLessThanOrEqual(bounds.right);
        }
        const last = within(dialog).getByRole('button', { name: /long-unbroken/ });
        last.scrollIntoView({ block: 'nearest' });
        await frameUser.click(last);
        await expect(onSelect).toHaveBeenCalledWith(notifications[3]);
        const close = within(dialog).getByRole('button', { name: '通知を閉じる' });
        await expect(close).toBeVisible();
        const closeBounds = close.getBoundingClientRect();
        await expect(closeBounds.top).toBeGreaterThanOrEqual(bounds.top);
        await expect(closeBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
        await frameUser.click(close);
        await waitFor(() => expect(frameCanvas.getByRole('button', { name: '通知を開く' })).toHaveFocus());
      }
  },
};

export const WorkflowResults: Story = {
  render: () => <Showcase items={[
    { id: 'deletion-rejected', type: 'deletion_request.rejected', category: 'action_required', title: '削除申請が却下されました', content: '申請の結果を確認してください。', is_read: false, created_at: null },
    { id: 'report-approved', type: 'report.approved', category: 'info', title: '記録が承認されました', content: '提出した記録が承認されました。', is_read: false, created_at: null },
  ]} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '通知を開く' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: '通知' });
    await waitFor(() => expect(within(dialog).getByText('要対応 · 未読')).toBeVisible());
    await expect(within(dialog).getByText('情報 · 未読')).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: /削除申請が却下されました/ })).toBeEnabled();
  },
};

export const DestinationUnavailable: Story = {
  render: () => <Showcase error="通知を開けませんでした。所属・権限を確認してもう一度お試しください。" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '通知を開く' }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: '通知' });
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeVisible());
    await expect(within(dialog).getByRole('button', { name: '通知を閉じる' })).toBeEnabled();
  },
};

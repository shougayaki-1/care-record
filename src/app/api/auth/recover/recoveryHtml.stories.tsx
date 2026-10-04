import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { recoveryHtml } from './recoveryHtml';

const meta = {
  title: 'Auth/RecoveryFallback',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
      const channel = Number(value) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export const ScreenWidths: Story = {
  render: () => (
    <div>
      {[false, true].flatMap(completed => [240, 320, 375, 1024].map(width => (
        <iframe
          key={`${completed}-${width}`}
          title={`${completed ? 'ログアウト完了' : '復旧'} ${width}px`}
          width={width}
          height={600}
          // No scripts or forms can run; the HTML has no app styles/providers/assets.
          sandbox="allow-same-origin"
          srcDoc={recoveryHtml(completed, 'storybook-preview')}
          style={{ display: 'block', border: 0, marginBottom: 16 }}
        />
      )))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const frame of canvasElement.querySelectorAll('iframe')) {
      await waitFor(() => expect(frame.contentDocument?.querySelector('.primary-action')).toBeTruthy());
      const doc = frame.contentDocument!;
      const view = frame.contentWindow!;
      const card = doc.querySelector('main')!;
      const action = doc.querySelector<HTMLElement>('.primary-action')!;
      const width = Number(frame.width);
      for (const scheme of ['light', 'dark']) {
        doc.documentElement.style.colorScheme = scheme;
        // Also verify 200% text sizing without hiding overflow.
        for (const fontSize of ['16px', '32px']) {
          doc.documentElement.style.fontSize = fontSize;
          await expect(doc.documentElement.scrollWidth).toBe(doc.documentElement.clientWidth);
          await expect(doc.body.scrollWidth).toBe(doc.body.clientWidth);
          for (const element of [card, action]) {
            const rect = element.getBoundingClientRect();
            await expect(rect.left).toBeGreaterThanOrEqual(0);
            await expect(rect.right).toBeLessThanOrEqual(width);
            await expect(element.scrollWidth).toBe(element.clientWidth);
          }
          const cardStyle = view.getComputedStyle(card);
          const actionStyle = view.getComputedStyle(action);
          const brandStyle = view.getComputedStyle(doc.querySelector('.brand')!);
          await expect(contrast(cardStyle.color, cardStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
          await expect(contrast(brandStyle.color, cardStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
          await expect(contrast(actionStyle.color, actionStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
        }
      }
      doc.documentElement.style.fontSize = '16px';
      await userEvent.setup({ document: doc }).tab();
      await expect(doc.activeElement).toBe(action);
      await expect(action.matches(':focus-visible')).toBe(true);
      const focused = view.getComputedStyle(action);
      await expect(focused.outlineStyle).toBe('solid');
      await expect(focused.outlineWidth).toBe('3px');
      await expect(contrast(focused.outlineColor, view.getComputedStyle(card).backgroundColor)).toBeGreaterThanOrEqual(3);
    }
  },
};

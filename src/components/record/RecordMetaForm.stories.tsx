import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { RecordMetaForm } from './RecordMetaForm';

const meta = {
  title: 'Record/RecordMetaForm',
  component: RecordMetaForm,
  parameters: { layout: 'fullscreen' },
  args: {
    actualServiceTypeId: '', serviceTypes: [], selectedHelpers: [], selectableStaffs: [],
    actualStaffs: [], staffRoles: [], startDateTime: '2026-10-02T09:00',
    endDateTime: '2026-10-02T10:00', serviceTime: '1', travelTime: '0.5',
    travelExpenses: {}, applyDefaultTravelCosts: false, errors: {}, aiFilledFields: new Set<string>(),
    disabled: false, onServiceTypeChange: fn(), onStaffChange: fn(), onActualStaffsChange: fn(),
    onStartChange: fn(), onEndChange: fn(), onServiceTimeChange: fn(),
    onTravelTimeChange: fn(), onTravelExpenseChange: fn(),
  },
} satisfies Meta<typeof RecordMetaForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ServiceDates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('開始日時', { exact: true })).toHaveValue('2026-10-02T09:00');
    await expect(canvas.getByLabelText('終了日時', { exact: true })).toHaveValue('2026-10-02T10:00');
  },
};

export const ScreenWidths: Story = {
  render: (args) => <div data-testid="form-width"><RecordMetaForm {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const container = canvas.getByTestId('form-width');
    for (const width of [240, 320, 375, 1280]) {
      container.style.width = `${width}px`;
      await expect(container.scrollWidth).toBeLessThanOrEqual(width);
      const bounds = container.getBoundingClientRect();
      for (const name of ['開始日時', '終了日時']) {
        const input = canvas.getByLabelText(name, { exact: true }) as HTMLInputElement;
        const label = input.labels![0];
        for (const element of [input, label]) {
          const rect = element.getBoundingClientRect();
          await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
          await expect(rect.right).toBeLessThanOrEqual(bounds.right);
        }
      }
    }
  },
};

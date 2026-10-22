import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { AggregatedData, ShiftVarianceRow } from '@/utils/statisticsAggregation';
import { StaffReportView } from './StaffReportView';
import { ShiftVarianceView } from './ShiftVarianceView';

const data: AggregatedData = {
  rows: [{ name: '職員A', plannedHours: 2, actualHours: 1, serviceHours: 1, travelHours: 0, internalHours: 0, statusCounts: { pending: 1, remanded: 0 } }],
  premiumComparisonPerStaff: {},
  detailItemsPerStaff: { '職員A': [{ id: 'report-a', kind: 'actual', clientName: '利用者A', reportId: 'report-a', clientId: 'client-a', startAt: '2026-10-22T01:00:00Z', endAt: '2026-10-22T02:00:00Z', hours: 1, status: 'pending' }] },
};
const meta = {
  title: 'Statistics/Views', component: StaffReportView,
  parameters: { layout: 'padded' },
  args: { tabIndex: 0, premiumTypes: [], visibleAggregatedData: data, expandedRows: {}, setExpandedRows: fn(), getDetailRecordHref: () => '/app/record/client-a?reportId=report-a', getDetailShiftHref: () => null },
} satisfies Meta<typeof StaffReportView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StaffDetails: Story = {
  render: function Render(args) {
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    return <StaffReportView {...args} expandedRows={expandedRows} setExpandedRows={setExpandedRows} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '差異詳細を開く' }));
    await expect(canvas.getByRole('link', { name: '実績確認' })).toHaveAttribute('href', '/app/record/client-a?reportId=report-a');
    await userEvent.click(canvas.getByRole('button', { name: '差異詳細を閉じる' }));
  },
};
export const EmptyDetails: Story = {
  args: { tabIndex: 1, visibleAggregatedData: { rows: [], premiumComparisonPerStaff: {}, detailItemsPerStaff: {} } },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).getAllByText('データがありません').length).toBeGreaterThan(0); },
};
const variance: ShiftVarianceRow = {
  id: 'shift-a', shiftId: 'shift-a', clientId: 'client-a', clientName: '利用者A', staffNames: '職員A',
  startAt: '2026-10-22T01:00:00Z', endAt: '2026-10-22T03:00:00Z', plannedH: 2, actualH: null, diffH: null,
  reportId: null, segmentId: null, actualStaffNames: '', hasStaffMismatch: false,
  actualServiceTypeName: null, hasServiceTypeMismatch: false, isUnplanned: false, isLegacyReport: false, isMonthClipped: false,
};
export const MissingReport: Story = {
  render: () => <ShiftVarianceView shiftVarianceRows={[variance]} shiftVarianceTotals={{ plannedH: 2, actualH: 0 }} getRecordHref={() => '/app/record/client-a?shiftId=shift-a'} getShiftHref={() => '/app/shifts/manage?shiftId=shift-a'} onNavigate={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: '実績作成' })).toHaveAttribute('href', '/app/record/client-a?shiftId=shift-a');
    await expect(canvas.getByRole('link', { name: 'シフト確認' })).toHaveAttribute('href', '/app/shifts/manage?shiftId=shift-a');
  },
};
export const EmptyVariance: Story = {
  render: () => <ShiftVarianceView shiftVarianceRows={[]} shiftVarianceTotals={{ plannedH: 0, actualH: 0 }} getRecordHref={() => null} getShiftHref={() => null} onNavigate={fn()} />,
};

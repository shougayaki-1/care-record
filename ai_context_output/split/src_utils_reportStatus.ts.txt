import type { ChipProps } from '@mui/material/Chip';

export type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';

export type ReportStatusChipColor = Extract<
  NonNullable<ChipProps['color']>,
  'default' | 'warning' | 'success' | 'error'
>;

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: '下書き',
  pending: '承認待ち',
  approved: '承認済',
  remanded: '差戻し',
};

export const REPORT_STATUS_CHIP_COLORS: Record<ReportStatus, ReportStatusChipColor> = {
  draft: 'default',
  pending: 'warning',
  approved: 'success',
  remanded: 'error',
};

export function isReportStatus(status: string): status is ReportStatus {
  return status in REPORT_STATUS_LABELS;
}

export function getReportStatusLabel(status: string, fallback = '不明な状態'): string {
  return isReportStatus(status) ? REPORT_STATUS_LABELS[status] : fallback;
}

export function getReportStatusChipColor(status: string): ReportStatusChipColor {
  return isReportStatus(status) ? REPORT_STATUS_CHIP_COLORS[status] : 'default';
}

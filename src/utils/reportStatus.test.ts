import { describe, expect, it } from 'vitest';
import { getReportStatusChipColor, getReportStatusLabel } from './reportStatus';

describe('report status presentation', () => {
  it.each([
    ['draft', '下書き', 'default'],
    ['pending', '承認待ち', 'default'],
    ['approved', '承認済', 'default'],
    ['remanded', '差戻し', 'warning'],
    ['unknown', '不明な状態', 'default'],
  ])('keeps %s identifiable by its label and appropriate tone', (status, label, tone) => {
    expect(getReportStatusLabel(status)).toBe(label);
    expect(getReportStatusChipColor(status)).toBe(tone);
  });
});

import { describe, expect, it } from 'vitest';
import { buildGasReportOutput } from './reportGasExport';
import type { ReportForCsvExport } from './reportsExport';
import type { FormItem } from './templateHelper';

const report: ReportForCsvExport = {
  id: 'report', start_at: '2026-10-01T00:05:00Z', end_at: '2026-10-01T01:15:00Z',
  created_at: '', updated_at: '', status: 'approved', approved_at: null,
  clients: { id: 'client', name: 'Client' }, helper: { name: 'Fallback' },
  report_values: { data: { _helpers: ['One', 'Two'], check: true, check_detail: 'detail',
    multi: ['A'], select: 'B', text: 'hello', empty: null, zero: 0, no: false } },
};

describe('GAS report conversion', () => {
  it('preserves checkbox, option, detail, empty and duplicate label contracts without mutating data', () => {
    const schema: FormItem[] = [
      { required: false, id: 'check', label: '●確認', type: 'checkbox', hasDetail: true },
      { required: false, id: 'multi', label: '選択', type: 'multicheckbox', options: ' A, B ', hasDetail: true },
      { required: false, id: 'select', label: '選択', type: 'select', options: 'A,B' },
      { required: false, id: 'text', label: '本文', type: 'text' }, { required: false, id: 'empty', label: '空欄', type: 'text' },
      { required: false, id: 'zero', label: '数', type: 'number' }, { required: false, id: 'no', label: '未選択', type: 'checkbox' },
    ];
    const before = structuredClone(report);
    const result = buildGasReportOutput(report, 'Client', schema);
    expect(result.data).toMatchObject({
      '利用者名': 'Client', '担当ヘルパー名': 'One, Two', 'サービス時間': '0', '移動時間': '0',
      '確認': true, '確認_詳細': 'detail', '選択_A': true, '選択_B': false, '選択_詳細': '',
      '選択_2_A': false, '選択_2_B': true, '本文': 'hello', '空欄': '', '数': 0, '未選択': false,
    });
    expect(result.fileName).toContain('Client_2026-10-1_提供記録');
    expect(report).toEqual(before);
  });

  it('keeps the filename date independent of template fields overriding the payload date', () => {
    const result = buildGasReportOutput(report, 'Client', [{ required: false, id: 'text', label: '開始日付', type: 'text' }]);
    expect(result.data['開始日付']).toBe('hello');
    expect(result.fileName).toContain('2026-10-1');
  });
});

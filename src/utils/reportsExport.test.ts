import { describe, expect, it } from 'vitest';

import type { FormItem } from './templateHelper';
import { buildReportsCsv, buildTravelSettlementCsv, getReportData, getReportHelperNames, type ReportForCsvExport } from './reportsExport';

const report: ReportForCsvExport = {
  id: 'report-1',
  start_at: '2026-07-01T09:00:00+09:00',
  end_at: '2026-07-01T10:30:00+09:00',
  created_at: '2026-07-01T00:00:00+09:00',
  updated_at: '2026-07-01T01:00:00+09:00',
  status: 'approved',
  approved_at: null,
  clients: { id: 'client-1', name: '利用者A' },
  helper: { name: '入力担当' },
  approved_by_user: { name: '承認担当' },
  report_values: {
    data: {
      _helpers: ['実施担当A', '実施担当B'],
      service_time: 1,
      travel_time: 0.5,
      care: ['食事'],
      completed: true,
      note: '声かけ"実施',
    },
  },
};

describe('report export helpers', () => {
  it('reads object and array report values and preserves helper precedence', () => {
    expect(getReportData(report)?.service_time).toBe(1);
    expect(getReportData({ ...report, report_values: [{ data: { service_time: 2 } }] })?.service_time)
      .toBe(2);
    expect(getReportHelperNames(report)).toBe('実施担当A, 実施担当B');
    expect(getReportHelperNames({
      ...report,
      report_values: { data: {} },
    })).toBe('入力担当');
  });

  it('expands template options, booleans, details, and escapes dynamic text', () => {
    const schema: FormItem[] = [{
      id: 'care',
      label: '介助',
      type: 'multicheckbox',
      options: '食事, 移動',
      required: false,
    }, {
      id: 'completed',
      label: '完了',
      type: 'checkbox',
      required: false,
    }, {
      id: 'note',
      label: '備考',
      type: 'text',
      required: false,
      hasDetail: true,
    }];

    const csv = buildReportsCsv([report], [{ schema }]);
    const [header, row] = csv.slice(1).split('\n');

    expect(header).toContain('介助_食事,介助_移動,完了,備考,備考_詳細');
    expect(row).toContain('承認済,client-1,利用者A,実施担当A, 実施担当B,入力担当');
    expect(row).toContain(',○,,○,"声かけ""実施",');
  });

  it('exports one settlement row per staff and flags legacy records without a breakdown', () => {
    const withExpenses: ReportForCsvExport = {
      ...report,
      report_values: { data: {
        travel_expenses: [
          { staff_id: 's1', staff_name: '職員A', method: 'car', amount_yen: 240 },
          { staff_id: 's2', staff_name: '=危険', method: 'public_transport', amount_yen: 460 },
        ],
      } as unknown as ReportForCsvExport['report_values'] extends { data: infer D } ? D : never },
    };
    const result = buildTravelSettlementCsv([withExpenses, report]);
    expect(result.itemCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.csv).toContain('"車","240"');
    expect(result.csv).toContain('"\'=危険","公共交通機関","460"');
  });
});

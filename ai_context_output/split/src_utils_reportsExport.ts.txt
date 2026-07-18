import type { FormItem, FormValue } from './templateHelper';
import { getReportStatusLabel } from './reportStatus';

export type ReportValuesData = Record<string, FormValue>;

export type ReportForCsvExport = {
  id: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
  status: string;
  approved_at: string | null;
  clients: { id: string; name: string };
  helper: { name: string } | Array<{ name: string }>;
  approved_by_user?: { name: string };
  report_values: { data: ReportValuesData } | Array<{ data: ReportValuesData }>;
};

type CsvColumnDef = {
  header: string;
  key: string;
  type: 'value' | 'bool' | 'option';
  matchValue?: string;
};

export function getReportData(report: ReportForCsvExport): ReportValuesData | null {
  if (!report.report_values) return null;
  if (Array.isArray(report.report_values)) return report.report_values[0]?.data ?? null;
  return report.report_values.data;
}

export function getReportHelperNames(report: ReportForCsvExport): string {
  const data = getReportData(report);
  const helpers = (data?._helpers as string[]) || [];
  if (helpers.length > 0) return helpers.join(', ');
  const fallbackName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;
  return fallbackName || '不明';
}

function buildDynamicColumns(templates: Array<{ schema: FormItem[] | null }>): CsvColumnDef[] {
  const dynamicColumns: CsvColumnDef[] = [];
  const seenHeaders = new Set<string>();

  templates.forEach((template) => {
    if (!template.schema) return;
    template.schema.forEach((item) => {
      if (item.type === 'section') return;
      if (['multicheckbox', 'select'].includes(item.type) && item.options) {
        item.options.split(',').forEach((option) => {
          const cleanOption = option.trim();
          const header = `${item.label}_${cleanOption}`;
          if (!seenHeaders.has(header)) {
            dynamicColumns.push({
              header,
              key: item.id,
              type: 'option',
              matchValue: cleanOption,
            });
            seenHeaders.add(header);
          }
        });
      } else if (item.type === 'checkbox') {
        const header = item.label;
        if (!seenHeaders.has(header)) {
          dynamicColumns.push({ header, key: item.id, type: 'bool' });
          seenHeaders.add(header);
        }
      } else {
        const header = item.label;
        if (!seenHeaders.has(header)) {
          dynamicColumns.push({ header, key: item.id, type: 'value' });
          seenHeaders.add(header);
        }
      }
      if (item.hasDetail) {
        const header = `${item.label}_詳細`;
        if (!seenHeaders.has(header)) {
          dynamicColumns.push({ header, key: `${item.id}_detail`, type: 'value' });
          seenHeaders.add(header);
        }
      }
    });
  });

  return dynamicColumns;
}

export function buildReportsCsv(
  reports: ReportForCsvExport[],
  templates: Array<{ schema: FormItem[] | null }>,
): string {
  const dynamicColumns = buildDynamicColumns(templates);
  const fixedHeader = [
    '記録ID',
    'ステータス',
    '利用者ID',
    '利用者名',
    '実施ヘルパー',
    '入力者名',
    '開始日付',
    '開始時刻',
    '終了日付',
    '終了時刻',
    'サービス時間(h)',
    '移動時間(h)',
    '往復距離(km)',
    '交通費(円)',
    '承認者名',
    '承認日時',
    '作成日時',
    '更新日時',
  ];
  const headerRow = [...fixedHeader, ...dynamicColumns.map((column) => column.header)];

  const rows = reports.map((report) => {
    const data = getReportData(report) || {};
    const start = new Date(report.start_at);
    const end = new Date(report.end_at);
    const formatDate = (date: Date) => (
      `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
    );
    const formatTime = (date: Date) => (
      `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    );
    const fallbackInputter = Array.isArray(report.helper)
      ? report.helper[0]?.name
      : report.helper?.name;

    const row: unknown[] = [
      report.id,
      getReportStatusLabel(report.status, report.status),
      report.clients.id,
      report.clients.name,
      getReportHelperNames(report),
      fallbackInputter || '不明',
      formatDate(start),
      formatTime(start),
      formatDate(end),
      formatTime(end),
      data.service_time || '0',
      data.travel_time || '0',
      data.round_trip_distance_km || '0',
      data.travel_cost_yen || '0',
      report.approved_by_user?.name || '',
      report.approved_at ? new Date(report.approved_at).toLocaleString() : '',
      new Date(report.created_at).toLocaleString(),
      new Date(report.updated_at).toLocaleString(),
    ];

    dynamicColumns.forEach((column) => {
      const rawValue = data[column.key];
      if (column.type === 'bool') {
        row.push(rawValue ? '○' : '');
      } else if (column.type === 'option') {
        const isMatch = Array.isArray(rawValue)
          ? rawValue.includes(column.matchValue || '')
          : typeof rawValue === 'string' && rawValue === column.matchValue;
        row.push(isMatch ? '○' : '');
      } else if (rawValue === null || rawValue === undefined) {
        row.push('');
      } else {
        const stringValue = Array.isArray(rawValue) ? rawValue.join(' ') : String(rawValue);
        row.push(`"${stringValue.replace(/"/g, '""')}"`);
      }
    });
    return row.join(',');
  });

  return '\uFEFF' + [headerRow.join(','), ...rows].join('\n');
}

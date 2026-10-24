import { generateKeyMap, type FormItem } from '@/utils/templateHelper';
import { getReportData, getReportHelperNames, type ReportValuesData, type ReportForCsvExport } from '@/utils/reportsExport';

// GAS expands select options to booleans; generic readable-data conversion does not.
function prepareGasFields(rawData: ReportValuesData, schema: FormItem[]): Record<string, unknown> {
  const keyMap = generateKeyMap(schema);
  const result: Record<string, unknown> = {};
  schema.forEach((item) => {
    const labelKey = keyMap[item.id] || item.id;
    const value = rawData[item.id];
    if (item.type === 'checkbox') {
      result[labelKey] = !!value;
    } else if (item.type === 'multicheckbox' || item.type === 'select') {
      const selectedValues = Array.isArray(value) ? value : (value ? [String(value)] : []);
      item.options?.split(',').forEach((option) => {
        const cleanOption = option.trim();
        result[`${labelKey}_${cleanOption}`] = selectedValues.includes(cleanOption);
      });
    } else {
      result[labelKey] = value == null ? '' : value;
    }
    if (item.hasDetail && ['checkbox', 'multicheckbox', 'select'].includes(item.type)) {
      result[`${labelKey}_詳細`] = rawData[`${item.id}_detail`] || '';
    }
  });
  return result;
}

export function buildGasReportOutput(report: ReportForCsvExport, clientName: string, schema: FormItem[]) {
  const data = getReportData(report) || {};
  const flatData: Record<string, string | number | boolean | null | undefined> = {};

  const start = new Date(report.start_at);
  const end = new Date(report.end_at);

  flatData['利用者名'] = clientName;
  flatData['担当ヘルパー名'] = getReportHelperNames(report);
  flatData['開始日付'] = `${start.getFullYear()}/${start.getMonth()+1}/${start.getDate()}`;
  flatData['開始時刻'] = `${start.getHours()}:${String(start.getMinutes()).padStart(2,'0')}`;
  flatData['終了日付'] = `${end.getFullYear()}/${end.getMonth()+1}/${end.getDate()}`;
  flatData['終了時刻'] = `${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}`;
  flatData['サービス時間'] = (data.service_time as string | number) || '0';
  flatData['移動時間'] = (data.travel_time as string | number) || '0';

  return {
    data: { ...flatData, ...prepareGasFields(data, schema) },
    fileName: `${clientName}_${(flatData['開始日付'] as string).replace(/\//g, '-')}_提供記録`,
  };
}

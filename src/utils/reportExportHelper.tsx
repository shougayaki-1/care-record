import { FormItem, FormValue } from '@/utils/templateHelper';

export type ReportStatus = 'draft' | 'pending' | 'approved' | 'remanded';
export type ReportValuesData = Record<string, FormValue>;

export type Report = {
  id: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
  status: ReportStatus;
  approved_at: string | null;
  clients: { id: string; name: string; organization_id: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { data: ReportValuesData } | { data: ReportValuesData }[];
};

export type CsvColumnDef = {
  header: string;
  key: string;
  type: 'value' | 'bool' | 'option';
  matchValue?: string;
};

export function getReportData(report: Report): ReportValuesData | null {
  if (!report.report_values) return null;
  if (Array.isArray(report.report_values)) return report.report_values[0]?.data;
  return (report.report_values as { data: ReportValuesData }).data;
}

export function getHelperNames(report: Report): string {
  const data = getReportData(report);
  const helpers = (data?._helpers as string[]) || [];
  if (helpers.length > 0) return helpers.join(', ');
  
  const fbName = Array.isArray(report.helper) ? report.helper[0]?.name : report.helper?.name;
  return fbName || '不明'; 
}

/**
 * GASのテンプレートへ差し込むための平坦なデータオブジェクトを構築します
 */
export function preparePdfData(
  rawData: ReportValuesData, 
  schema: FormItem[], 
  keyMap: Record<string, string>
// ★修正: Record<string, any> を Record<string, FormValue> に変更しました
): Record<string, FormValue> {
  // ★修正: Record<string, any> を Record<string, FormValue> に変更しました
  const result: Record<string, FormValue> = {};
  schema.forEach(item => {
    const labelKey = keyMap[item.id] || item.id;
    const val = rawData[item.id];
    if (item.type === 'checkbox') {
      result[labelKey] = !!val; 
      if (item.hasDetail) {
        const detailKey = `${labelKey}_詳細`;
        result[detailKey] = rawData[`${item.id}_detail`] || "";
      }
    } else if (item.type === 'multicheckbox' || item.type === 'select') {
      const selectedValues: string[] = Array.isArray(val) ? val : (val ? [String(val)] : []);
      if (item.options) {
        item.options.split(',').forEach((opt: string) => {
          const cleanOpt = opt.trim();
          const optKey = `${labelKey}_${cleanOpt}`;
          result[optKey] = selectedValues.includes(cleanOpt);
        });
      }
      if (item.hasDetail) {
        const detailKey = `${labelKey}_詳細`;
        result[detailKey] = rawData[`${item.id}_detail`] || "";
      }
    } else {
      result[labelKey] = (val === null || val === undefined) ? "" : val;
    }
  });
  return result;
}
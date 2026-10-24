import { supabase } from '@/lib/supabase';
import type { ReportStatus } from '@/utils/reportStatus';
import type { ReportValuesData } from '@/utils/reportsExport';
import type { FormItem } from '@/utils/templateHelper';

export type Report = {
  id: string; start_at: string; end_at: string; created_at: string; updated_at: string; status: ReportStatus; approved_at: string | null;
  segment_id: string | null;
  segment?: { service_type: { name: string } | null } | null;
  clients: { id: string; name: string; organization_id: string };
  helper: { name: string };
  approved_by_user?: { name: string };
  report_values: { helpers: string[] | null } | { helpers: string[] | null }[] | null;
};

export type ExportReport = Omit<Report, 'report_values'> & {
  report_values: { data: ReportValuesData } | { data: ReportValuesData }[];
};

const REPORT_PAGE_SIZE = 50;

export async function loadReportValues(reports: Report[]): Promise<ExportReport[]> {
  const valuesById = new Map<string, ReportValuesData>();
  for (let start = 0; start < reports.length; start += REPORT_PAGE_SIZE) {
    const ids = reports.slice(start, start + REPORT_PAGE_SIZE).map((report) => report.id);
    const { data, error } = await supabase.from('report_values').select('report_id, data').in('report_id', ids);
    if (error) throw error;
    for (const row of data ?? []) valuesById.set(row.report_id, row.data as ReportValuesData);
  }
  return reports.map((report) => {
    const value = valuesById.get(report.id);
    if (value == null) throw new Error('Export report body is missing');
    return { ...report, report_values: { data: value } };
  });
}

// Capture selection and metadata before the first await (including confirmation).
export function snapshotExportReports(reports: Report[], selected: readonly string[]): Report[] {
  return structuredClone(selected.length > 0 ? reports.filter((report) => selected.includes(report.id)) : reports);
}

export async function loadExportTemplates(clientIds: string[]) {
  const { data, error } = await supabase.from('form_templates').select('client_id, schema').in('client_id', clientIds);
  if (error) throw error;
  return (data ?? []).map((template) => ({ client_id: template.client_id, schema: template.schema as FormItem[] | null }));
}

export async function loadPdfTemplate(clientId: string): Promise<FormItem[]> {
  const { data, error } = await supabase.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  return (data?.schema as FormItem[] | null) ?? [];
}

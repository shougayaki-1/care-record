import { serviceRoleForBackup } from '@/utils/supabase/serviceRole';
import { sanitizeDbError } from '@/utils/errors';
import { convertDataToReadable, type FormItem, type FormValue } from '@/utils/templateHelper';

const supabaseAdmin = serviceRoleForBackup();

type ReportRow = {
  id: string;
  client_id: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  helper: { name: string } | { name: string }[] | null;
  clients: { name: string } | { name: string }[] | null;
  report_values: { data: Record<string, unknown> | null } | { data: Record<string, unknown> | null }[] | null;
};

function escapeCsvCell(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function relationName(
  relation: { name: string } | { name: string }[] | null | undefined,
): string {
  if (!relation) return '';
  return Array.isArray(relation) ? (relation[0]?.name ?? '') : (relation.name ?? '');
}

function reportValuesData(
  reportValues: ReportRow['report_values'],
): Record<string, unknown> | null {
  if (!reportValues) return null;
  return Array.isArray(reportValues)
    ? (reportValues[0]?.data ?? null)
    : (reportValues.data ?? null);
}

function toReadableValues(
  values: Record<string, unknown> | null,
  schema: FormItem[] | undefined,
): Record<string, unknown> | null {
  if (!values) return null;
  if (!schema) return values;
  return convertDataToReadable(values as Record<string, FormValue>, schema) as Record<string, unknown>;
}

export async function getActiveOrganizationIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .is('deleted_at', null);
  if (error) throw sanitizeDbError(error, 'gcs.export.organizations');
  return (data ?? []).map((org: { id: string }) => org.id);
}

export async function exportReportsAsCsv(orgId: string): Promise<string> {
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (clientError) throw sanitizeDbError(clientError, 'gcs.export.clients');
  const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
  if (clientIds.length === 0) return '';

  const { data: templates, error: templateError } = await supabaseAdmin
    .from('form_templates')
    .select('client_id, schema')
    .in('client_id', clientIds);
  if (templateError) throw sanitizeDbError(templateError, 'gcs.export.templates');

  const schemaByClientId = new Map<string, FormItem[]>();
  (templates ?? []).forEach((template: { client_id: string; schema: unknown }) => {
    if (Array.isArray(template.schema)) {
      schemaByClientId.set(template.client_id, template.schema as FormItem[]);
    }
  });

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(`
      id,
      client_id,
      start_at,
      end_at,
      status,
      created_at,
      updated_at,
      helper:profiles!reports_helper_id_fkey(name),
      clients(name),
      report_values(data)
    `)
    .in('client_id', clientIds)
    .is('deleted_at', null)
    .order('start_at', { ascending: false });
  if (error) throw sanitizeDbError(error, 'gcs.export.reports');

  const rows = (data ?? []) as ReportRow[];
  const header = ['id', '利用者名', '開始日時', '終了日時', '担当者', 'ステータス', '記録内容(JSON)', '作成日時', '更新日時'];
  const lines = [
    header.join(','),
    ...rows.map((r) => {
      const values = toReadableValues(reportValuesData(r.report_values), schemaByClientId.get(r.client_id));
      return [
        r.id,
        relationName(r.clients),
        r.start_at ?? '',
        r.end_at ?? '',
        relationName(r.helper),
        r.status,
        values != null ? JSON.stringify(values) : '',
        r.created_at ?? '',
        r.updated_at ?? '',
      ]
        .map(escapeCsvCell)
        .join(',');
    }),
  ];
  return lines.join('\n');
}

export async function exportReportsAsJson(
  orgId: string,
  year: number,
  month: number,
): Promise<string> {
  const startOfMonth = new Date(year, month - 1, 1).toISOString();
  const startOfNextMonth = new Date(year, month, 1).toISOString();

  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (clientError) throw sanitizeDbError(clientError, 'gcs.export.clients-json');
  const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
  if (clientIds.length === 0) {
    return JSON.stringify({
      schema_version: '1.0',
      export_date: new Date().toISOString(),
      organization_id: orgId,
      year,
      month,
      records: [],
      record_count: 0,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(`
      id,
      client_id,
      start_at,
      end_at,
      status,
      created_at,
      updated_at,
      helper:profiles!reports_helper_id_fkey(name),
      clients(name),
      report_values(data)
    `)
    .in('client_id', clientIds)
    .is('deleted_at', null)
    .gte('start_at', startOfMonth)
    .lt('start_at', startOfNextMonth)
    .order('start_at', { ascending: true });
  if (error) throw sanitizeDbError(error, 'gcs.export.reports-json');

  const records = data ?? [];
  return JSON.stringify(
    {
      schema_version: '1.0',
      export_date: new Date().toISOString(),
      organization_id: orgId,
      year,
      month,
      records,
      record_count: records.length,
    },
    null,
    2,
  );
}

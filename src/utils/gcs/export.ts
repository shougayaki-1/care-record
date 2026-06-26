import { supabaseAdmin } from '@/utils/supabase/auth';

type ReportRow = {
  id: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  values: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  helper: { name: string } | { name: string }[] | null;
  clients: { name: string } | { name: string }[] | null;
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

export async function getActiveOrganizationIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .is('deleted_at', null);
  if (error) throw new Error(`組織一覧の取得に失敗しました: ${error.message}`);
  return (data ?? []).map((org: { id: string }) => org.id);
}

export async function exportReportsAsCsv(orgId: string): Promise<string> {
  const { data: clients, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null);
  if (clientError) throw new Error(`利用者一覧の取得に失敗しました: ${clientError.message}`);
  const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
  if (clientIds.length === 0) return '';

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(`
      id,
      start_at,
      end_at,
      status,
      values,
      created_at,
      updated_at,
      helper:profiles!reports_helper_id_fkey(name),
      clients(name)
    `)
    .in('client_id', clientIds)
    .is('deleted_at', null)
    .order('start_at', { ascending: false });
  if (error) throw new Error(`記録の取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as ReportRow[];
  const header = ['id', '利用者名', '開始日時', '終了日時', '担当者', 'ステータス', '記録内容(JSON)', '作成日時', '更新日時'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.id,
        relationName(r.clients),
        r.start_at ?? '',
        r.end_at ?? '',
        relationName(r.helper),
        r.status,
        r.values != null ? JSON.stringify(r.values) : '',
        r.created_at ?? '',
        r.updated_at ?? '',
      ]
        .map(escapeCsvCell)
        .join(','),
    ),
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
  if (clientError) throw new Error(`利用者一覧の取得に失敗しました: ${clientError.message}`);
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
      start_at,
      end_at,
      status,
      values,
      created_at,
      updated_at,
      helper:profiles!reports_helper_id_fkey(name),
      clients(name)
    `)
    .in('client_id', clientIds)
    .is('deleted_at', null)
    .gte('start_at', startOfMonth)
    .lt('start_at', startOfNextMonth)
    .order('start_at', { ascending: true });
  if (error) throw new Error(`記録の取得に失敗しました: ${error.message}`);

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

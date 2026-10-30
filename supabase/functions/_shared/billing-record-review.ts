// Build one bounded page of advisory record checks from the existing authorized RPCs.
// Do not return source values or template data to the MCP client.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Deno requires explicit TypeScript extensions
import { checkRecordQuality } from './record-quality.ts';
import type { FormItem } from './validate-candidate.ts';

type QualitySource = Parameters<typeof checkRecordQuality>[0];
type RecordRow = { id: string; service_date: string | null; status: string };
type RecordPage = { records: RecordRow[]; has_more: boolean; limit: number; offset: number };

export async function reviewBillingRecords(
  page: RecordPage,
  getSource: (id: string) => Promise<QualitySource | null>,
  template: FormItem[],
) {
  const checks = await Promise.all(page.records.map(async (record) => {
    const source = await getSource(record.id);
    // The record may have become inaccessible since the list was read. Do not
    // return the stale identifier or status after an authorization change.
    if (!source) throw new Error('記録を再確認できませんでした。もう一度お試しください。');
    const check = checkRecordQuality(source, template);
    const issues = [...check.issues];
    if (record.status !== 'approved') issues.unshift('記録の承認状態を確認してください');
    return { record_id: record.id, service_date: record.service_date, status: record.status,
      issues, check_status: issues.length ? 'needs_confirmation' as const : 'no_issues_detected' as const };
  }));
  return { records: checks.filter(check => check.check_status === 'needs_confirmation'),
    scanned: checks.length, has_more: page.has_more, limit: page.limit, offset: page.offset };
}

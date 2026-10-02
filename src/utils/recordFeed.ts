import type { MyReportHistoryResult } from '@/app/actions/reports';
import type { InternalWorkRecord } from '@/app/actions/internalWork';
import type { getMyAiSubmissions } from '@/app/actions/aiCandidates';

export type RecordFeedItem = {
  id: string;
  kind: 'report' | 'internal' | 'ai_submission';
  startAt: string;
  title: string;
  status: 'pending' | 'approved' | 'remanded';
  href?: string;
  detail?: string;
  authorName?: string;
};

export function buildRecordFeed(reports: MyReportHistoryResult['items'], internal: InternalWorkRecord[], submissions: Awaited<ReturnType<typeof getMyAiSubmissions>>, options: { startAt?: string; endAt?: string; limit?: number; authors?: Record<string, string> } = {}): RecordFeedItem[] {
  const items: RecordFeedItem[] = [
    ...reports.map((report): RecordFeedItem => ({ id: report.id, kind: 'report', startAt: report.start_at, title: `${report.clients?.name ?? '利用者未設定'} 様`, status: report.status, authorName: options.authors?.[report.authorId ?? ''], href: `/app/record/${report.client_id}?reportId=${report.id}` })),
    ...internal.map((record): RecordFeedItem => ({ id: record.id, kind: 'internal', startAt: record.start_at, title: record.title, status: record.status, authorName: options.authors?.[record.recorded_by ?? ''], detail: `${record.staffs?.name ?? 'スタッフ未設定'} · ${Number(record.work_hours).toFixed(2)}時間` })),
    ...submissions.map((item): RecordFeedItem => {
      const extractedDate = item.recordDate ? `${item.recordDate}T${item.startTime || '00:00'}:00+09:00` : '';
      return { id: item.id, kind: 'ai_submission', startAt: Number.isFinite(Date.parse(extractedDate)) ? extractedDate : item.createdAt, title: item.clientName || item.sourceFileName || '利用者未特定', status: 'pending', authorName: options.authors?.[item.authorId], detail: 'AI送信 · 管理者確認待ち' };
    }),
  ];
  const unique = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
  return [...unique.values()].filter((item) => {
    const date = Date.parse(item.startAt);
    return Number.isFinite(date) && (!options.startAt || date >= Date.parse(options.startAt)) && (!options.endAt || date < Date.parse(options.endAt));
  }).sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
    .slice(0, options.limit ?? 100);
}

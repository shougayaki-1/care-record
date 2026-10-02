import { describe, expect, it } from 'vitest';
import { buildRecordFeed } from './recordFeed';
import type { MyReportHistoryResult } from '@/app/actions/reports';
import type { InternalWorkRecord } from '@/app/actions/internalWork';
const normal: MyReportHistoryResult['items'][number] = { id: 'shared-id', start_at: '2026-10-02T09:00:00+09:00', status: 'pending', client_id: 'client', clients: { name: '利用者' }, authorId: 'author' };
const internal: InternalWorkRecord = { id: 'shared-id', organization_id: 'org', staff_id: 'staff', title: '会議', work_type: 'meeting', start_at: '2026-10-02T10:00:00+09:00', end_at: '2026-10-02T11:00:00+09:00', work_hours: 1, status: 'pending', note: null, staffs: { name: '担当' }, recorded_by: 'author' };
const candidate = { id: 'candidate', recordDate: '2026-10-02', startTime: '08:00', createdAt: '2026-10-03T12:00:00Z', clientName: 'AI利用者', sourceFileName: 'record.pdf', authorId: 'author' };
describe('own record feed', () => {
  it('uses service datetime rather than AI upload time and deduplicates within each kind', () => {
    const feed = buildRecordFeed([normal, normal], [internal], [candidate], { authors: { author: '作成者' } });
    expect(feed.map((item) => item.kind)).toEqual(['internal', 'report', 'ai_submission']);
    expect(feed).toHaveLength(3); expect(feed.every((item) => item.authorName === '作成者')).toBe(true);
    expect(feed[1].href).toBe('/app/record/client?reportId=shared-id');
  });
  it('uses one half-open date range for all kinds', () => {
    const feed = buildRecordFeed([normal], [internal], [candidate], { startAt: '2026-10-02T09:00:00+09:00', endAt: '2026-10-02T10:00:00+09:00' });
    expect(feed.map((item) => item.kind)).toEqual(['report']);
  });
  it('replaces an approved candidate with the regular report rather than retaining both', () => {
    expect(buildRecordFeed([], [], [candidate])).toHaveLength(1);
    const feed = buildRecordFeed([{ ...normal, status: 'approved' }], [], []);
    expect(feed).toHaveLength(1); expect(feed[0].kind).toBe('report'); expect(feed[0].status).toBe('approved');
  });
  it('has deterministic tie ordering and limits after merging', () => {
    const tied = [{ ...normal, id: 'b' }, { ...normal, id: 'a' }];
    expect(buildRecordFeed(tied, [], [], { limit: 1 })[0].id).toBe('a');
  });
});

'use server';

import { getMyReportHistory } from './reports';
import { getMyAiSubmissions } from './aiCandidates';
import { getMyInternalWorkHistory } from './internalWork';
import { buildRecordFeed } from '@/utils/recordFeed';
import { createSessionClient } from '@/utils/supabase/auth';
import { sanitizeDbError, withSafeError } from '@/utils/errors';

export async function getMyRecordFeed(organizationId: string, options: { startAt?: string; endAt?: string } = {}) {
  return withSafeError('getMyRecordFeed', async () => {
    const [reports, internal, submissions] = await Promise.all([
      getMyReportHistory(organizationId, options),
      getMyInternalWorkHistory(organizationId, options),
      getMyAiSubmissions(organizationId),
    ]);
    const ids = [...new Set([...reports.items.map((item) => item.authorId), ...internal.map((item) => item.recorded_by), ...submissions.map((item) => item.authorId)].filter((id): id is string => Boolean(id)))];
    const session = await createSessionClient();
    const { data: profiles, error } = ids.length ? await session.from('profiles').select('id, name').in('id', ids) : { data: [], error: null };
    if (error) throw sanitizeDbError(error, 'action.recordFeed');
    const authors = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.name || '名前未設定']));
    return buildRecordFeed(reports.items, internal, submissions, { ...options, authors });
  });
}

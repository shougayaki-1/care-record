import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';
const mocks = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), org: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ getAuthedUser: mocks.user, assertRecordPermission: mocks.permission, assertOrgPermission: mocks.org, assertOrgRole: mocks.org, createSessionClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: unknown) => error }));
import { discardReportAutosave, getMyReportHistory, saveReport, softDeleteReports, transitionReports, uploadReportImage } from './reports';
const input = { organizationId: 'org', clientId: 'client', reportId: 'report', startAt: '2026-10-06T10:00:00+09:00', endAt: '2026-10-06T11:00:00+09:00', status: 'draft' as const, values: {}, expectedVersion: 2, idempotencyKey: '00000000-0000-4000-8000-000000000001' };
function query(data: unknown, error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), is: vi.fn(() => q), maybeSingle: vi.fn(async () => ({ data, error })) };
  return q;
}
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: 'actor', sessionId: 'session' }); mocks.permission.mockResolvedValue({ userId: 'actor' }); mocks.org.mockResolvedValue({ userId: 'actor' }); });
describe('versioned report result boundary', () => {
  it('keeps the atomic save payload and replay result, without a second write', async () => {
    mocks.rpc.mockResolvedValue({ data: { recordId: 'report', revisionId: 'revision', version: 3, replayed: true }, error: null });
    await expect(saveReport(input)).resolves.toMatchObject({ ok: true, data: { reportId: 'report', version: 3, replayed: true } });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('save_report_versioned', expect.objectContaining({ p_expected_version: 2, p_idempotency_key: input.idempotencyKey, p_session_id: 'session' }));
  });
  it('returns a conflict code without exposing the current revision or DB text and keeps the failure audit', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'CR409', message: '{"currentRevisionId":"private-revision"}' } });
    const result = await saveReport(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } });
    expect(JSON.stringify(result)).not.toContain('private-revision');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'report.save', outcome: 'failure', sessionId: 'session', details: { attemptedStatus: 'draft', errorType: 'CR409' } }));
  });
  it('classifies the documented permission refusal but keeps similar DB errors unexpected', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'access_denied' } })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'access_denied private SQL' } });
    await expect(saveReport(input)).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const result = await saveReport(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private SQL');
  });
  it('returns session refusal before querying or saving', async () => {
    mocks.user.mockRejectedValue(new ExpectedActionError('SESSION_EXPIRED', '再度ログインしてください'));
    await expect(saveReport(input)).resolves.toMatchObject({ ok: false, error: { code: 'SESSION_EXPIRED' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['transition', 'deletion'])('does not report success or a success audit after a %s RPC failure', async mode => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42P01', message: 'private_table 権限 column' } });
    const result = mode === 'transition' ? await transitionReports('org', ['report'], 'approve') : await softDeleteReports('org', ['report'], '削除理由');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('private_table');
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('retains void-like operation success as result data', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(discardReportAutosave('org', 'draft')).resolves.toEqual({ ok: true, data: { success: true } });
  });
  it('keeps missing staff mapping distinct from a staff lookup failure', async () => {
    mocks.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null, { message: 'private staff failure' }));
    await expect(getMyReportHistory('org')).resolves.toEqual({ ok: true, data: { status: 'staff_mapping_missing', items: [] } });
    await expect(getMyReportHistory('org')).resolves.toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
  });
});

it.each([
  ['report_image_limit_exceeded', 'VALIDATION_ERROR'],
  ['report_image_rate_limited', 'RATE_LIMITED'],
  ['report_image_limit_exceeded private detail', 'UNEXPECTED_ERROR'],
])('stops before upload when image reservation returns %s', async (message, code) => {
  mocks.from.mockReturnValue(query({ id: 'report', status: 'draft' }));
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message } });
  const form = new FormData();
  form.set('organizationId', 'org'); form.set('reportId', 'report');
  form.set('file', new File(['synthetic'], 'image.png', { type: 'image/png' }));
  const result = await uploadReportImage(form);
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(result)).not.toContain('private detail');
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.audit).not.toHaveBeenCalled();
});

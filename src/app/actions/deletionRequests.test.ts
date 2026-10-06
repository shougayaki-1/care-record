import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readActionResult } from '@/utils/actionResult';
import { ExpectedActionError } from '@/utils/errors';
const state = vi.hoisted(() => ({ role: vi.fn(), management: vi.fn(), record: vi.fn(), rpc: vi.fn(), audit: vi.fn(), from: vi.fn(), single: vi.fn(), order: vi.fn(), eq: vi.fn(), limit: vi.fn(), reports: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({ assertOrgRole: state.role, assertOrgPermission: state.management, assertRecordPermission: state.record, createSessionClient: async () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: state.audit }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: vi.fn() }));
import { approveDeletionRequest, listDeletionRequests, rejectDeletionRequest, requestReportDeletion } from './deletionRequests';
const org = '60000000-0000-4000-8000-000000000010';
const request = '60000000-0000-4000-8000-000000000050';
beforeEach(() => {
  vi.clearAllMocks();
  state.role.mockResolvedValue({ userId: 'applicant' }); state.management.mockResolvedValue({ userId: 'manager' }); state.record.mockResolvedValue({ userId: 'manager' });
  state.rpc.mockResolvedValue({ data: request, error: null });
  const query = { select: () => query, eq: state.eq, maybeSingle: state.single, order: state.order, limit: state.limit, in: state.reports };
  state.from.mockReturnValue(query); state.eq.mockReturnValue(query); state.order.mockReturnValue(query); state.limit.mockResolvedValue({ data: [], error: null });
  state.reports.mockResolvedValue({ data: [], error: null });
  state.single.mockResolvedValue({ data: { id: request, resource_type: 'report', resource_id: 'report', status: 'requested', reason: 'synthetic reason', clients: { organization_id: org } }, error: null });
});
describe('deletion workflow Actions use the atomic notification RPC contract', () => {
  it('creates through the session RPC and keeps the existing audit event', async () => {
    expect(await readActionResult(requestReportDeletion(org, 'report', 'synthetic reason'))).toEqual({ success: true, requestId: request });
    expect(state.rpc).toHaveBeenCalledWith('request_report_deletion', { p_org_id: org, p_report_id: 'report', p_reason: 'synthetic reason' });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'deletion_request.create', resourceId: request }));
    expect(state.from).not.toHaveBeenCalledWith('notifications');
  });
  it('does not create a success audit or send notifications when the atomic RPC fails', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'PHI fixture DB failure', code: 'P0001' } });
    const result = await requestReportDeletion(org, 'report', 'synthetic reason');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('PHI'); expect(state.audit).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalledWith('notifications');
  });
  it('retains both delete permission checks and the approval audit', async () => {
    state.rpc.mockResolvedValue({ data: { retentionUntil: '2031-10-07' }, error: null });
    await readActionResult(approveDeletionRequest(org, request));
    expect(state.management).toHaveBeenCalledWith(org, 'reports');
    expect(state.record).toHaveBeenCalledWith(org, 'delete', { reportId: 'report' });
    expect(state.rpc).toHaveBeenCalledWith('decide_report_deletion', { p_org_id: org, p_request_id: request, p_decision: 'approve' });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'deletion_request.approve' }));
  });
  it('retains management-only rejection, without putting its reason into notifications', async () => {
    await readActionResult(rejectDeletionRequest(org, request, 'synthetic reason'));
    expect(state.management).toHaveBeenCalledWith(org, 'reports'); expect(state.record).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledWith('decide_report_deletion', { p_org_id: org, p_request_id: request, p_decision: 'reject' });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'deletion_request.reject', details: { reason: 'synthetic reason' } }));
  });
  it('does not process a decision when permission has been revoked', async () => {
    state.record.mockRejectedValue(new ExpectedActionError('FORBIDDEN', 'この操作を行う権限がありません'));
    expect(await approveDeletionRequest(org, request)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it('lets members list their own result with request precision and session RLS', async () => {
    await readActionResult(listDeletionRequests(org, 'all', request));
    expect(state.role).toHaveBeenCalledWith(org); expect(state.management).not.toHaveBeenCalled();
    expect(state.eq).toHaveBeenCalledWith('organization_id', org); expect(state.eq).toHaveBeenCalledWith('id', request);
  });
  it('rejects invalid targeted links before making a query', async () => {
    expect(await listDeletionRequests(org, 'all', 'invalid')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(state.limit).not.toHaveBeenCalled();
  });
});

it('only adds detail links for reports visible to the session RLS', async () => {
  state.limit.mockResolvedValue({ data: [{ id: request, resource_type: 'report', resource_id: 'report' }], error: null });
  expect(await readActionResult(listDeletionRequests(org, 'all'))).toEqual([expect.objectContaining({ clientId: null })]);
  state.reports.mockResolvedValue({ data: [{ id: 'report', client_id: 'visible-client' }], error: null });
  expect(await readActionResult(listDeletionRequests(org, 'all'))).toEqual([expect.objectContaining({ clientId: 'visible-client' })]);
  expect(state.reports).toHaveBeenCalledWith('id', ['report']);
});

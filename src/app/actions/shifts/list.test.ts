import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/database.generated';
import type { ShiftListSource } from '@/features/shifts/adapters';

const mocks = vi.hoisted(() => ({ session: vi.fn(), actor: vi.fn(), permissions: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
    createSessionClient: mocks.session, assertShiftPermission: mocks.actor, getEffectivePermissions: mocks.permissions,
}));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: vi.fn() }));
vi.mock('./internal', () => ({}));
vi.mock('./googleSyncInternal', () => ({}));
import { getShifts } from './crud';

const shift: ShiftListSource = {
    id: 'shift', organization_id: 'org', client_id: 'client', title: null,
    start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-01T01:00:00Z',
    status: 'published', cancel_reason: null, clients: null, shift_staffs: [], shift_segments: [], report_shifts: [],
};
let request: URL;
let rows: ShiftListSource[];
const load = (filter = {}) => getShifts('org', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', filter);

beforeEach(() => {
    vi.clearAllMocks();
    rows = [shift];
    mocks.actor.mockResolvedValue({ userId: 'user', isOwner: true, staffId: 'me', clientIds: ['client'] });
    mocks.permissions.mockResolvedValue({ permissions: { shifts: { view: 'assigned' } } });
    mocks.session.mockResolvedValue(createClient<Database>('http://127.0.0.1:54321', 'test-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async input => {
            request = new URL(String(input));
            return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } },
    }));
});

describe('getShifts projection and visibility', () => {
    it('keeps organization, deletion, overlap and descending start-time filters', async () => {
        const { shift_segments: _segments, ...expected } = shift;
        void _segments;
        await expect(load()).resolves.toMatchObject({ ok: true, data: [{ ...expected, report_statuses: [] }] });
        expect(mocks.actor).toHaveBeenCalledWith('org', 'view', { requireAllScope: false, clientId: undefined });
        expect(Object.fromEntries(request.searchParams)).toMatchObject({ organization_id: 'eq.org',
            deleted_at: 'is.null', start_at: 'lt.2026-11-01T00:00:00Z', end_at: 'gt.2026-10-01T00:00:00Z',
            order: 'start_at.desc' });
        expect(request.searchParams.get('select')).toContain('shift_staffs(staff_id,staffs(name))');
        expect(request.searchParams.get('select')).not.toContain('!inner');
    });

    it('matches segment staff when filtering and preserves client filtering', async () => {
        rows = [{ ...shift, shift_segments: [{ shift_segment_staffs: [{ staff_id: 'staff' }] }] }];
        const result = await load({ staffId: 'staff', clientId: 'client' });
        expect(result.ok && result.data.map(row => row.id)).toEqual(['shift']);
        expect(request.searchParams.get('select')).toContain('shift_segments');
        expect(request.searchParams.get('staff_filter.staff_id')).toBe('eq.staff');
        expect(request.searchParams.get('segment_filter.shift_segment_staffs.staff_id')).toBe('eq.staff');
        expect(request.searchParams.get('or')).toBe('(staff_filter.not.is.null,segment_filter.not.is.null)');
        expect(request.searchParams.get('client_id')).toBe('eq.client');
        expect(mocks.actor).toHaveBeenCalledWith('org', 'view', { requireAllScope: false, clientId: 'client' });
    });

    it.each(['all', 'assigned'])('preserves %s visibility for non-owners', async scope => {
        mocks.actor.mockResolvedValue({ userId: 'user', isOwner: false, staffId: 'me', clientIds: ['client'] });
        mocks.permissions.mockResolvedValue({ permissions: { shifts: { view: scope } } });
        rows = [shift,
            { ...shift, id: 'staff-assigned', client_id: 'other', shift_staffs: [{ staff_id: 'me', staffs: null }] },
            { ...shift, id: 'segment-assigned', client_id: 'other', shift_segments: [{ shift_segment_staffs: [{ staff_id: 'me' }] }] },
            { ...shift, id: 'invisible', client_id: 'other' }];
        const result = await load();
        expect(result.ok && result.data.map(row => row.id)).toEqual(scope === 'all'
            ? ['shift', 'staff-assigned', 'segment-assigned', 'invisible'] : ['shift', 'staff-assigned', 'segment-assigned']);
    });

    it('does not let an unlinked staff account see unrelated clients', async () => {
        mocks.actor.mockResolvedValue({ userId: 'user', isOwner: false, staffId: null, clientIds: [] });
        await expect(load()).resolves.toEqual({ ok: true, data: [] });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(), getUser: vi.fn(), getToken: vi.fn(), setCredentials: vi.fn(),
    calendarGet: vi.fn(), calendarInsert: vi.fn(), nonce: vi.fn(), audit: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({
    rpc: mocks.rpc, auth: { getUser: mocks.getUser },
}) }));
vi.mock('@/utils/googleCalendar', () => ({
    OAUTH_STATE_COOKIE: 'g_oauth_state',
    getGoogleOAuthClient: () => ({ getToken: mocks.getToken, setCredentials: mocks.setCredentials }),
}));
vi.mock('googleapis', () => ({ google: { calendar: () => ({ calendars: {
    get: mocks.calendarGet, insert: mocks.calendarInsert,
} }) } }));
vi.mock('@/utils/googleTokenCrypto', () => ({ encryptGoogleToken: () => 'encrypted-test-token' }));
vi.mock('@/utils/supabase/oauthNonce', () => ({ consumeOAuthNonce: mocks.nonce }));
vi.mock('@/utils/supabase/audit', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/utils/errors', () => ({ logExternalError: vi.fn() }));
vi.mock('@/utils/log', () => ({ logWarn: vi.fn() }));
vi.mock('@/lib/env/server', () => ({ areExternalIntegrationsEnabled: () => true }));

import { GET } from './route';

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'test-user' } } });
    mocks.getToken.mockResolvedValue({ tokens: { refresh_token: 'test-refresh-token' } });
    mocks.nonce.mockResolvedValue({ requiresGoogleIdentityMatch: false });
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_google_oauth_context'
        ? { data: { name: 'Test', google_calendar_id: 'existing-calendar' }, error: null }
        : { data: null, error: null });
});

afterEach(() => vi.useRealTimers());

const request = () => new NextRequest('https://app.example/app/api/google/callback?code=test-code&state=test-nonce', {
    headers: { cookie: 'g_oauth_state=test-nonce:test-org' },
});

describe('reauthorization preserves the existing calendar connection', () => {
    it.each([
        [403, 'google_forbidden'],
        [404, 'google_calendar_missing'],
        [401, 'google_reauth_required'],
    ])('does not overwrite stored credentials after HTTP %i', async (status, error) => {
        mocks.calendarGet.mockRejectedValue({ response: { status } });
        const response = await GET(request());
        expect(response.headers.get('location')).toBe(`https://app.example/app/settings?error=${error}`);
        expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['get_google_oauth_context']);
        expect(mocks.calendarInsert).not.toHaveBeenCalled();
        expect(response.cookies.get('g_oauth_state')?.value).toBe('');
    });

    it('retries temporary errors and saves the new token against the same calendar', async () => {
        vi.useFakeTimers();
        mocks.calendarGet.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue({ data: {} });
        const responsePromise = GET(request());
        await vi.runAllTimersAsync();
        const response = await responsePromise;
        expect(response.headers.get('location')).toContain('success=calendar_connected');
        expect(mocks.calendarGet).toHaveBeenCalledTimes(2);
        expect(mocks.rpc).toHaveBeenCalledWith('complete_google_oauth_connection', {
            p_org_id: 'test-org', p_encrypted_refresh_token: 'encrypted-test-token',
            p_calendar_id: 'existing-calendar', p_status: 'healthy',
        });
        expect(mocks.calendarInsert).not.toHaveBeenCalled();
    });

    it('leaves stored credentials unchanged when temporary failures persist', async () => {
        vi.useFakeTimers();
        mocks.calendarGet.mockRejectedValue({ response: { status: 503 } });
        const responsePromise = GET(request());
        await vi.runAllTimersAsync();
        const response = await responsePromise;
        expect(response.headers.get('location')).toContain('error=google_temporarily_unavailable');
        expect(mocks.calendarGet).toHaveBeenCalledTimes(3);
        expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['get_google_oauth_context']);
    });
});

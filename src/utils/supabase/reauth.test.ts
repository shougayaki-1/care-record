import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAuthedUser: vi.fn(), from: vi.fn() }));

vi.mock('./auth', () => ({
  getAuthedUser: mocks.getAuthedUser,
}));

vi.mock('./serviceRole', () => ({
  serviceRoleForServerSessions: () => ({ from: mocks.from }),
}));

vi.mock('@/utils/authConstants', () => ({
  REAUTH_GRANT_TTL_MINUTES: 10,
  REAUTH_GRACE_PERIOD_MINUTES: 5,
}));

import { tryReuseRecentReauthGrant } from './reauth';

function makeSelectQuery(result: { data: { id: string } | null; error: { message: string } | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    not: vi.fn(() => query),
    gt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

function makeInsertQuery(result: { error: { message: string } | null }) {
  return { insert: vi.fn(async () => result) };
}

describe('tryReuseRecentReauthGrant', () => {
  it('does not touch the database and returns null for purposes outside the grace-period allowlist', async () => {
    mocks.getAuthedUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });

    const result = await tryReuseRecentReauthGrant('organization_delete');

    expect(result).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns null when no recent verification exists for the current session/purpose', async () => {
    mocks.getAuthedUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'reauth_grants') return makeSelectQuery({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await tryReuseRecentReauthGrant('external_secret_change');

    expect(result).toBeNull();
  });

  it('issues a fresh grant token when a recent verification exists within the grace period', async () => {
    mocks.getAuthedUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'reauth_grants') {
        // 最初の呼び出し(検索)はselectを使い、2回目の呼び出し(発行)はinsertを使うため、
        // insertが呼ばれた時だけinsertクエリを返すモックにする。
        const select = makeSelectQuery({ data: { id: 'grant-1' }, error: null });
        const insert = makeInsertQuery({ error: null });
        return { ...select, ...insert };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await tryReuseRecentReauthGrant('external_secret_change');

    expect(result).not.toBeNull();
    expect(typeof result?.token).toBe('string');
    expect(result?.token.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

function makeChallengeQuery(result: { data: Row | null; error: { message: string } | null }) {
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    gt: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

function makeInsertQuery(result: { error: { message: string } | null }) {
  return { insert: vi.fn(async () => result) };
}

const mocks = vi.hoisted(() => ({ createSessionClient: vi.fn(), from: vi.fn() }));

vi.mock('@/utils/supabase/auth', () => ({
  supabaseAdmin: { from: mocks.from },
  createSessionClient: mocks.createSessionClient,
  getAuthedUser: vi.fn(),
}));

import { beginStepUpReauth, completeStepUpReauth } from './stepupReauth';

describe('beginStepUpReauth', () => {
  it('starts the OAuth step-up even when the account also has a password, as long as a Google/Azure identity is linked', async () => {
    mocks.createSessionClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1', identities: [{ provider: 'email' }, { provider: 'google' }] } },
          error: null,
        })),
      },
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'stepup_reauth_challenges') return makeInsertQuery({ error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await beginStepUpReauth('external_secret_change');

    expect(result.provider).toBe('google');
  });

  it('rejects when the account has no SSO identity linked at all', async () => {
    mocks.createSessionClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1', identities: [{ provider: 'email' }] } },
          error: null,
        })),
      },
    });

    await expect(beginStepUpReauth('external_secret_change'))
      .rejects.toThrow('連携されたログイン方法が見つかりません');
  });
});

describe('completeStepUpReauth', () => {
  it('rejects when the challenge nonce is unknown, expired, or already consumed', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'stepup_reauth_challenges') return makeChallengeQuery({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(completeStepUpReauth('bad-nonce', 'user-1', 'session-1'))
      .rejects.toThrow('再認証証明が無効または使用済みです');
  });

  it('rejects when the OAuth flow signed in as a different account than the one who started it', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'stepup_reauth_challenges') {
        return makeChallengeQuery({ data: { user_id: 'user-original', purpose: 'external_secret_change' }, error: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(completeStepUpReauth('nonce-1', 'user-switched', 'session-1'))
      .rejects.toThrow('選択したアカウントが元のログインアカウントと一致しません');
  });

  it('issues a reauth grant token when the challenge and session user match', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'stepup_reauth_challenges') {
        return makeChallengeQuery({ data: { user_id: 'user-1', purpose: 'organization_delete' }, error: null });
      }
      if (table === 'reauth_grants') return makeInsertQuery({ error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const result = await completeStepUpReauth('nonce-1', 'user-1', 'session-1');
    expect(result.purpose).toBe('organization_delete');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
  });
});

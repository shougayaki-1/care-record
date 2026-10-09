import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ result: vi.fn() }));
vi.mock('./auth', () => ({ createSessionClient: vi.fn(async () => {
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.result };
  return { from: () => query };
}) }));
import { getRetentionPolicy } from './retentionPolicy';
describe('retention policy failures', () => {
  it('explains an unapproved shift policy', async () => {
    mocks.result.mockResolvedValue({ data: null, error: null });
    await expect(getRetentionPolicy('org', 'shift')).rejects.toThrow('オーナーに保持方針の承認を依頼');
  });
  it('does not expose a database error as a missing policy', async () => {
    mocks.result.mockResolvedValue({ data: null, error: { message: 'private db detail' } });
    await expect(getRetentionPolicy('org', 'shift')).rejects.toThrow('処理に失敗しました');
  });
});

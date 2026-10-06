import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyShiftsWithStatus } from './myShifts';

const mocks = vi.hoisted(() => ({ from: vi.fn(), user: vi.fn(), log: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  getAuthedUser: mocks.user,
  createSessionClient: async () => ({ from: mocks.from }),
}));
vi.mock('@/utils/log', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/log')>(), logError: mocks.log,
}));

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

const shift = { id: 'shift-1', organization_id: 'org-1', client_id: 'client-1',
  start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-01T01:00:00Z', status: 'published',
  title: null, cancel_reason: null, clients: null, shift_staffs: [] };
const load = () => getMyShiftsWithStatus('org-1', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 'user-1' });
});

describe('getMyShiftsWithStatus', () => {
  it('returns success [] without querying reports when the month has no shifts', async () => {
    const staff = query({ id: 'staff-1' });
    const shifts = query([]);
    mocks.from.mockReturnValueOnce(staff).mockReturnValueOnce(shifts);
    await expect(load()).resolves.toEqual({ ok: true, data: [] });
    expect(mocks.from.mock.calls).toEqual([['staffs'], ['shifts']]);
    expect(staff.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['user_id', 'user-1']]);
    expect(shifts.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['shift_staffs.staff_id', 'staff-1']]);
    expect(shifts.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it.each([{ reports: [] }, { reports: [{ id: 'report-1', shift_id: 'shift-1', status: 'submitted' }] }])(
    'returns shifts successfully with zero or more reports: $reports', async ({ reports }) => {
      mocks.from.mockReturnValueOnce(query({ id: 'staff-1' }))
        .mockReturnValueOnce(query([shift])).mockReturnValueOnce(query(reports));
      await expect(load()).resolves.toEqual({ ok: true, data: [{ ...shift,
        report: reports.length ? { id: 'report-1', status: 'submitted' } : null }] });
    },
  );

  it('returns a plain typed expected state for missing staff', async () => {
    mocks.from.mockReturnValueOnce(query(null));
    await expect(load()).resolves.toEqual({ ok: false, error: {
      code: 'STAFF_NOT_LINKED',
      message: 'スタッフアカウントが紐付いていません。事業所設定を確認してください。',
    } });
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each(['staffs', 'shifts', 'reports'])('sanitizes %s query failure instead of treating it as missing data', async table => {
    // Includes a legacy safe-message substring; DB details must still never escape.
    const error = { message: 'private_column が見つかりません', code: 'TEST_DB_FAILURE' };
    mocks.from.mockImplementation(name => name === table ? query(null, error) :
      query(name === 'staffs' ? { id: 'staff-1' } : [shift]));
    await expect(load()).rejects.toThrow('処理に失敗しました。時間をおいて再度お試しください。');
    expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining('[db:getMyShiftsWithStatus:'), {
      organizationId: 'org-1', error,
    });
  });

  it('logs unexpected failures and throws only a generic error', async () => {
    mocks.user.mockRejectedValueOnce(new Error('synthetic internal failure'));
    await expect(load()).rejects.toThrow('処理に失敗しました。時間をおいて再度お試しください。');
    expect(mocks.log).toHaveBeenCalledWith('[action:getMyShiftsWithStatus]', expect.objectContaining({
      error: expect.objectContaining({ message: 'synthetic internal failure' }),
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('preserves the expected action result through the production React Flight action transport', async () => {
    mocks.from.mockReturnValueOnce(query(null));
    const result = await load();
    // Next's action handler transports a resolved/rejected promise as `a` in Flight.
    // Use the installed production encoder/decoder without Next, a DB, or a network listener.
    const decoded = execFileSync(process.execPath, ['--conditions=react-server', '-e', `
      const fs = require('node:fs');
      const { renderToReadableStream } = require('next/dist/compiled/react-server-dom-webpack/server.node');
      const { createFromReadableStream } = require('next/dist/compiled/react-server-dom-webpack/client.node');
      (async () => {
        const value = JSON.parse(fs.readFileSync(0, 'utf8'));
        const options = { serverConsumerManifest: { moduleMap: {}, serverModuleMap: {}, moduleLoading: null } };
        const stream = await renderToReadableStream({ a: Promise.resolve(value) }, {});
        const payload = await createFromReadableStream(stream, options);
        const expected = await payload.a;
        const rejected = await renderToReadableStream({ a: Promise.reject(new Error('synthetic hidden detail')) }, {}, { onError: () => 'test-digest' });
        const failure = await createFromReadableStream(rejected, options);
        let redacted = false;
        try { await failure.a; } catch (error) { redacted = !error.message.includes('synthetic hidden detail'); }
        process.stdout.write(JSON.stringify({ expected, redacted }));
      })().catch(() => process.exit(1));
    `], { input: JSON.stringify(result), encoding: 'utf8', env: { NODE_ENV: 'production' }, timeout: 10000 });
    expect(JSON.parse(decoded)).toEqual({ expected: result, redacted: true });
    expect(decoded).not.toContain('441');
  });
});

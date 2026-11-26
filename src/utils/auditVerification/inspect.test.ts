import { expect, it, vi } from 'vitest';
import type { Store } from '@/utils/auditArchive/contracts';
const mocks = vi.hoisted(() => ({archive:vi.fn(), legacy:vi.fn()}));
vi.mock('@/utils/auditArchive/publisher', () => ({readPreservedArchive:mocks.archive, readCurrentExactArchiveObject:vi.fn()}));
vi.mock('./legacy', () => ({readLegacyClassification:mocks.legacy, compareLegacyStructure:vi.fn()}));
import { inspectPreservation } from './inspect';

it('uses the same frozen control reference for archive inspection and snapshot creation', async () => {
  const pin = {name:'control/staging/root.json',generation:'9007199254740993',size:'10',digest:'a'.repeat(64)};
  const expected = {...pin};
  mocks.archive.mockImplementation(async (_store, anchor) => {
    expect(anchor).toEqual(expected);
    pin.generation = '9007199254740994';
    return {cutoverId:'15200000-0000-4000-8000-000000000001', ordinal:'1', manifestRef:expected,
      latestComplete:new Date().toISOString(),baselineRef:expected,v1Count:'0',v1Digest:'a'.repeat(64)};
  });
  mocks.legacy.mockResolvedValue({});
  const begin=vi.fn<(signal?: AbortSignal, control?: typeof pin) => Promise<string>>().mockResolvedValue('not-a-uuid');
  const source={begin,page:async () => null};
  await expect(inspectPreservation({} as Store,pin,'staging',source)).rejects.toMatchObject({category:'mismatch'});
  expect(begin).toHaveBeenCalledOnce();
  expect(begin.mock.calls[0][1]).toEqual(expected);
});

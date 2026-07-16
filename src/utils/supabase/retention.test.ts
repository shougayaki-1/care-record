import { describe, expect, it } from 'vitest';
import { purgeExpiredRecords } from './retention';

describe('purgeExpiredRecords safety contract', () => {
  it('rejects attempts to enable physical deletion', async () => {
    await expect(purgeExpiredRecords(false)).rejects.toThrow('Physical deletion is disabled');
  });
});

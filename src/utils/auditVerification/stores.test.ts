import { describe, expect, it, vi } from 'vitest';
import type { Store } from '@/utils/auditArchive/contracts';
import { verificationStores } from './stores';

function store(): Store {
  return { list: vi.fn(async () => ({names: []})), read: vi.fn(async () => null),
    create: vi.fn(async () => { throw new Error('unexpected'); }) };
}

describe('verification store boundaries', () => {
  it('allows only same-environment archive and control reads, never writes', async () => {
    const underlying = store();
    const { archiveStore } = verificationStores('staging', underlying, store());
    await archiveStore.read('control/staging/root.json', '9007199254740993');
    await archiveStore.list('archive/staging/');
    expect(underlying.read).toHaveBeenCalledWith('control/staging/root.json', '9007199254740993');
    for (const name of ['archive/production/x', 'control/staging-other/x', 'archive/staging/../production/x', 'verification/staging/runs/1/1.json']) {
      await expect(archiveStore.read(name)).rejects.toMatchObject({category: 'mismatch'});
    }
    await expect(archiveStore.create('archive/staging/x', Buffer.from('x'))).rejects.toMatchObject({category: 'mismatch'});
    expect(underlying.create).not.toHaveBeenCalled();
  });
  it('rejects unexpected objects in listing results', async () => {
    const underlying = store();
    underlying.list = vi.fn(async () => ({names: ['archive/production/x']}));
    const { archiveStore } = verificationStores('staging', underlying, store());
    await expect(archiveStore.list('archive/staging/')).rejects.toMatchObject({category: 'mismatch'});
  });
  it('permits only fixed receipt object names and disallows listing', async () => {
    const underlying = store();
    const { receiptStore } = verificationStores('staging', store(), underlying);
    await receiptStore.read('verification/staging/runs/123/1.json', '9007199254740993');
    expect(underlying.read).toHaveBeenCalledWith('verification/staging/runs/123/1.json', '9007199254740993');
    for (const name of ['verification/production/runs/1/1.json', 'verification/staging/runs/01/1.json', 'verification/staging/runs/1/../x', 'archive/staging/x']) {
      await expect(receiptStore.create(name, Buffer.from('x'))).rejects.toMatchObject({category: 'mismatch'});
    }
    await expect(receiptStore.list('verification/staging/')).rejects.toMatchObject({category: 'mismatch'});
    expect(underlying.create).not.toHaveBeenCalled();
  });
});

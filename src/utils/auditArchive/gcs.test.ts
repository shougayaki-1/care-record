import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/gcs/upload', () => ({ getStorage: () => ({ authClient: { getRequestHeaders: async () => ({ authorization: 'Bearer test-only' }) } }) }));
import { boundedBody, createArchiveStore } from './gcs';
import { MAX_BYTES, sha256 } from './contracts';

afterEach(() => vi.unstubAllGlobals());
describe('GCS create-only receipts', () => {
  it.each(['412', 'response_loss', 'success'])('reconciles %s and reads the exact generation as decimal text', async scenario => {
    const bytes = Buffer.from('immutable'); const generation = '90071992547409931234';
    const calls: { url: URL; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(input); calls.push({ url, init });
      if (init.method === 'POST') {
        expect(url.searchParams.get('ifGenerationMatch')).toBe('0');
        expect(init.redirect).toBe('error');
        if (scenario === 'response_loss') throw new Error('lost response with private data');
        return new Response('{}', { status: scenario === '412' ? 412 : 200 });
      }
      if (url.searchParams.get('alt') === 'media') {
        expect(url.searchParams.get('generation')).toBe(generation);
        return new Response(bytes);
      }
      return Response.json({ generation, size: String(bytes.length) });
    }));
    const store = createArchiveStore('care-record-local-test-audit-worm', 'archive/local/');
    const saved = await store.create('archive/local/test/chunks/test.json', bytes);
    expect(saved.ref.generation).toBe(generation); expect(saved.ref.digest).toBe(sha256(bytes));
    expect(calls).toHaveLength(3);
  });
  it('fails closed on IAM denial, oversized objects, and forbidden control writes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    const store = createArchiveStore('bucket', 'archive/local/');
    await expect(store.create('archive/local/chunks/test.json', Buffer.from('test'))).rejects.toThrow();
    await expect(store.create('control/local/root.json', Buffer.from('test'))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generation: '123', size: String(MAX_BYTES + 1) })));
    await expect(store.read('test')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds response streams by bytes, including metadata and error responses', async () => {
    await expect(boundedBody(new Response(Buffer.alloc(MAX_BYTES + 1)))).rejects.toThrow();
    expect((await boundedBody(new Response(Buffer.alloc(MAX_BYTES)))).length).toBe(MAX_BYTES);
  });
});

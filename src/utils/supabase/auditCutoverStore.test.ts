import { afterEach, expect, it, vi } from 'vitest';
import { operatorStore } from '../../../scripts/audit/cutover-store.mjs';

vi.mock('@google-cloud/storage', () => ({
  Storage: class { authClient = { async getRequestHeaders() { return {}; } }; },
}));
afterEach(() => vi.unstubAllGlobals());

it('control publication uses create-only and exact decimal generations even after an ambiguous upload', async () => {
  const bytes = Buffer.from('{"schema":"fixture"}');
  const generation = '9007199254740993123';
  const urls: URL[] = [];
  const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
    urls.push(new URL(url));
    if (init?.method === 'POST') {
      expect(url.searchParams.get('ifGenerationMatch')).toBe('0');
      throw new Error('response lost after commit');
    }
    if (url.searchParams.get('alt') === 'media') {
      expect(url.searchParams.get('generation')).toBe(generation);
      return new Response(bytes);
    }
    return Response.json({ generation, size: String(bytes.length) });
  });
  vi.stubGlobal('fetch', fetchMock);
  const store = await operatorStore('fixture-local-audit', 'local');
  const saved = await store.create('control/local/cutover/control.json', bytes);
  expect(saved.ref.generation).toBe(generation);
  expect((await store.read(saved.ref.name, generation))!.bytes.equals(bytes)).toBe(true);
  expect(urls.filter(url => url.searchParams.get('generation') === generation).length).toBeGreaterThanOrEqual(3);
  await expect(store.create('archive/local/forbidden.json', bytes)).rejects.toThrow();
});

it('rejects 412 collisions with different bytes, wrong generation and oversized complete responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response('{}', { status: 412 });
    if (url.searchParams.get('alt') === 'media') return new Response('different');
    return Response.json({ generation: '2', size: '9' });
  }));
  const store = await operatorStore('fixture-local-audit', 'local');
  await expect(store.create('control/local/collision.json', Buffer.from('original'))).rejects.toThrow();
  await expect(store.read('control/local/root.json', '1')).rejects.toThrow();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1))));
  await expect(store.read('control/local/too-large.json')).rejects.toThrow();
});

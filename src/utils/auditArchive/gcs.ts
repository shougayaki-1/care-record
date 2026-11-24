import 'server-only';
import { getStorage } from '@/utils/gcs/upload';
import { ArchiveFailure, MAX_BYTES, decimal, sha256, type Store, type ObjectRef } from './contracts';

// The installed storage SDK coerces File({generation: string}) to Number.
// Use authenticated JSON API requests to preserve the decimal generation verbatim.
export async function boundedBody(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ArchiveFailure('unavailable');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) throw new ArchiveFailure('unavailable');
      parts.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}
export function createArchiveStore(bucket: string, writablePrefix: string): Store {
  const storage = getStorage();
  async function request(url: URL, init?: RequestInit) {
    const auth = await storage.authClient.getRequestHeaders(url.toString());
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(auth)) headers.set(key, value);
    return fetch(url, { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  }
  async function read(name: string, generation?: string) {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`);
    if (generation) url.searchParams.set('generation', decimal.parse(generation));
    const metadata = await request(url);
    if (metadata.status === 404) return null;
    if (!metadata.ok) throw new ArchiveFailure('unavailable');
    const meta = JSON.parse((await boundedBody(metadata)).toString()) as Record<string, unknown>;
    const exactGeneration = decimal.parse(meta.generation);
    const size = decimal.parse(meta.size);
    if ((generation && generation !== exactGeneration) || BigInt(size) > BigInt(MAX_BYTES)) throw new ArchiveFailure('mismatch');
    url.searchParams.set('generation', exactGeneration);
    url.searchParams.set('alt', 'media');
    const content = await request(url);
    if (!content.ok) throw new ArchiveFailure('unavailable');
    const bytes = await boundedBody(content);
    if (BigInt(bytes.length) !== BigInt(size)) throw new ArchiveFailure('mismatch');
    const ref: ObjectRef = { name, generation: exactGeneration, size, digest: sha256(bytes) };
    return { bytes, ref };
  }
  return {
    async list(prefix, cursor) {
      const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('maxResults', '1000');
      url.searchParams.set('fields', 'items(name),nextPageToken');
      if (cursor) url.searchParams.set('pageToken', cursor);
      const response = await request(url);
      if (!response.ok) throw new ArchiveFailure('unavailable');
      const body = JSON.parse((await boundedBody(response)).toString()) as { items?: { name: string }[]; nextPageToken?: string };
      if ((body.items && !Array.isArray(body.items)) || (body.nextPageToken && typeof body.nextPageToken !== 'string')) throw new ArchiveFailure('mismatch');
      const names = (body.items ?? []).map(item => item.name);
      if (names.some(name => typeof name !== 'string' || !name.startsWith(prefix))) throw new ArchiveFailure('mismatch');
      return { names, cursor: body.nextPageToken };
    },
    read,
    async create(name, bytes) {
      if (!name.startsWith(writablePrefix) || bytes.length > MAX_BYTES) throw new ArchiveFailure('mismatch');
      const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set('uploadType', 'media');
      url.searchParams.set('name', name);
      url.searchParams.set('ifGenerationMatch', '0');
      try {
        const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array(bytes) });
        // 412 is a competing publisher or retry, never permission to overwrite.
        if (!response.ok && response.status !== 412) throw new ArchiveFailure('unavailable');
        await boundedBody(response);
      } catch {
        // An ambiguous upload may have committed. Always reconcile exact bytes.
      }
      const saved = await read(name);
      if (!saved) throw new ArchiveFailure('unavailable');
      return saved;
    },
  };
}

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_BYTES = 1024 * 1024;
export const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const digest = z.string().regex(/^[0-9a-f]{64}$/);
const scope = z.string().regex(/^(global|org:[0-9a-f-]{36})$/);
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
export const refSchema = z.object({ name: z.string(), generation: decimal, size: decimal, digest });
export type ObjectRef = z.infer<typeof refSchema>;
export const headSchema = z.object({ kind: z.literal('head'), scope, sequence: decimal, hash: z.string(), cutoverId: z.uuid() });
export const eventSchema = z.object({
  kind: z.enum(['v1', 'v2']), version: z.number().int(), scope, sequence: decimal,
  // Preserve malformed historical v1 hashes too. v2 validates its exact SHA-256
  // against canonical bytes in the publisher; v1 anomalies stay unresolved.
  id: z.uuid(), eventId: z.uuid(), hash: z.string().nullable(), previousHash: z.string().nullable(),
  cutoverId: z.uuid().nullable(), inventory: z.string(), canonical: z.string().nullable(),
});
export const itemSchema = z.union([headSchema, eventSchema]);
export type Item = z.infer<typeof itemSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Head = z.infer<typeof headSchema>;
export const cursorSchema = z.tuple([z.enum(['head', 'v1', 'v2']), z.string(), decimal, z.uuid()]).nullable();
export type Cursor = z.infer<typeof cursorSchema>;
export const pageSchema = z.object({ items: z.array(itemSchema).max(500), cursor: cursorSchema, more: z.boolean() });
export type Page = z.infer<typeof pageSchema>;
export const controlSchema = z.object({
  schema: z.literal('audit-control:1'), environment: z.enum(['staging', 'production', 'local']),
  cutoverId: z.union([z.literal('pre-cutover'), z.uuid()]), baselineFinalized: z.boolean(),
  // G supplies this immutable v1 baseline receipt; B cannot establish it by itself.
  baseline: refSchema.nullable(), monitoringStartedAt: z.iso.datetime(),
});
export type Control = z.infer<typeof controlSchema>;
export interface Store {
  list(prefix: string, cursor?: string): Promise<{ names: string[]; cursor?: string }>;
  read(name: string, generation?: string): Promise<{ ref: ObjectRef; bytes: Buffer } | null>;
  create(name: string, bytes: Buffer): Promise<{ ref: ObjectRef; bytes: Buffer }>;
}
export interface Source {
  begin(positions: Record<string, string>, includeV1: boolean): Promise<string>;
  page(run: string, cursor: Cursor): Promise<Page>;
  cache(ordinal: string, digest: string): Promise<void>;
  record(status: 'complete' | 'inventory', count: string): Promise<void>;
}
export class ArchiveFailure extends Error {
  constructor(readonly category: 'unavailable' | 'mismatch' | 'incomplete' | 'not_configured') { super(category); }
}
export function requireCondition(value: unknown): asserts value {
  if (!value) throw new ArchiveFailure('mismatch');
}
export function decodeBase64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  requireCondition(bytes.toString('base64') === value);
  return bytes;
}

import { z } from 'zod';
import {
  ArchiveFailure, controlSchema, cursorSchema, headSchema, decimal, decodeBase64, digest, encode, itemSchema,
  MAX_BYTES, pageSchema, refSchema, requireCondition, sha256,
  type Control, type Cursor, type Event, type Head, type Item, type ObjectRef, type Source, type Store,
} from './contracts';

const rangeSchema = z.object({ scope: z.string(), start: decimal, end: decimal, count: decimal, headHash: digest });
const snapshotSchema = z.object({ cursor: cursorSchema, v1Count: decimal, v1Digest: digest, heads: z.array(headSchema), requiredScopes: z.array(z.string()) });
type Snapshot = z.infer<typeof snapshotSchema>;
const emptyDigest = sha256(Buffer.alloc(0));
function addV1(previous: string, event: Event) {
  return sha256(Buffer.concat([Buffer.from(previous, 'hex'), encode([event.id, validateEvent(event)])]));
}
const manifestSchema = z.object({
  schema: z.literal('audit-manifest:1'), environment: controlSchema.shape.environment,
  cutoverId: z.string(), ordinal: decimal, previousDigest: digest.nullable(),
  run: z.uuid(), createdAt: z.iso.datetime(),
  kind: z.enum(['chunk', 'inventory', 'complete']), chunk: refSchema.nullable(),
  snapshot: snapshotSchema, v1Count: decimal.nullable(), v1Digest: digest.nullable(), ranges: z.array(rangeSchema),
});
const chunkSchema = z.object({ schema: z.literal('audit-chunk:1'), items: z.array(itemSchema).max(500) });
const baselineSchema = z.object({
  schema: z.literal('audit-baseline:1'), environment: controlSchema.shape.environment,
  cutoverId: z.uuid(), v1Count: decimal, v1Digest: digest, inventoryReceipt: refSchema,
  // Historical anomalies remain unresolved; preservation is not a chain verdict.
  historicalVerdict: z.literal('unresolved'),
});
export type Manifest = z.infer<typeof manifestSchema>;
type Position = { sequence: string; hash: string };
type State = {
  ordinal: string; digest: string | null; positions: Map<string, Position>;
  baseline: { v1Count: string; v1Digest: string } | null; inventory: Map<string, string>; pending: Manifest | null; runs: Map<string, Snapshot>; latestComplete: string | null; latestKind: Manifest['kind'] | null;
};
export type ArchiveResult = { status: 'complete' | 'inventory' | 'incomplete'; archived: string };
export function archivePrefix(control: Control): string {
  return `archive/${control.environment}/${control.cutoverId}/`;
}
async function exact(store: Store, ref: ObjectRef) {
  const object = await store.read(ref.name, ref.generation);
  requireCondition(object && object.ref.digest === ref.digest && object.ref.size === ref.size && object.ref.generation === ref.generation);
  return object;
}
export async function loadControl(store: Store, pinned: ObjectRef, environment: string): Promise<Control> {
  requireCondition(pinned.name.startsWith(`control/${environment}/`));
  const object = await exact(store, pinned);
  const control = controlSchema.parse(JSON.parse(object.bytes.toString()));
  requireCondition(control.environment === environment);
  requireCondition(control.baselineFinalized === (control.baseline !== null));
  requireCondition(!control.baselineFinalized || control.cutoverId !== 'pre-cutover');
  return control;
}
function validateEvent(event: Event): string {
  const raw = decodeBase64(event.inventory);
  const inventory = JSON.parse(raw.toString()) as unknown[];
  requireCondition(Array.isArray(inventory) && inventory.length === 22 && inventory[0] === 'audit-inventory:2');
  requireCondition(inventory[1] === event.id && inventory[2] === event.eventId && inventory[17] === event.hash
    && inventory[16] === event.previousHash && inventory[18] === event.version
    && inventory[19] === (event.kind === 'v1' ? null : event.scope)
    && inventory[20] === (event.kind === 'v1' ? null : event.sequence) && inventory[21] === event.cutoverId);
  requireCondition(event.scope === (inventory[3] === null ? 'global' : `org:${inventory[3]}`));
  if (event.kind === 'v1') {
    requireCondition(event.version === 1 && event.sequence === '0' && event.cutoverId === null && event.canonical === null);
  } else {
    requireCondition(event.version === 2 && event.canonical !== null);
    const canonical = decodeBase64(event.canonical);
    requireCondition(sha256(canonical) === event.hash);
    const expected = [inventory[18], inventory[21], inventory[19], inventory[20], inventory[1], inventory[2], ...inventory.slice(3, 16), inventory[16]];
    requireCondition(JSON.stringify(JSON.parse(canonical.toString())) === JSON.stringify(expected));
  }
  return sha256(raw);
}
function apply(items: Item[], state: State, control: Control) {
  for (const item of items) {
    if (item.kind === 'head') {
      requireCondition(control.baselineFinalized && item.cutoverId === control.cutoverId);
      continue;
    }
    const rowDigest = validateEvent(item);
    if (item.kind === 'v1') continue;
    requireCondition(control.baselineFinalized && item.cutoverId === control.cutoverId);
    const key = `${item.scope}/${item.sequence}`;
    const existing = state.inventory.get(key);
    if (existing) { requireCondition(existing === rowDigest); continue; }
    const previous = state.positions.get(item.scope) ?? { sequence: '0', hash: `GENESIS:v2:${control.cutoverId}:${item.scope}` };
    requireCondition(BigInt(item.sequence) === BigInt(previous.sequence) + BigInt(1) && item.previousHash === previous.hash);
    state.inventory.set(key, rowDigest);
    state.positions.set(item.scope, { sequence: item.sequence, hash: item.hash! });
  }
}
function ranges(items: Item[]) {
  const result = new Map<string, z.infer<typeof rangeSchema>>();
  for (const item of items) {
    if (item.kind !== 'v2') continue;
    const range = result.get(item.scope);
    if (!range) result.set(item.scope, { scope: item.scope, start: item.sequence, end: item.sequence, count: '1', headHash: item.hash! });
    else { range.end = item.sequence; range.count = (BigInt(range.count) + BigInt(1)).toString(); range.headHash = item.hash!; }
  }
  return [...result.values()];
}
async function accept(store: Store, saved: { bytes: Buffer; ref: ObjectRef }, state: State, control: Control) {
  const manifest = manifestSchema.parse(JSON.parse(saved.bytes.toString()));
  const prefix = archivePrefix(control);
  requireCondition(manifest.environment === control.environment && manifest.cutoverId === control.cutoverId
    && manifest.ordinal === (BigInt(state.ordinal) + BigInt(1)).toString() && manifest.previousDigest === state.digest
    && saved.ref.name === `${prefix}manifests/${manifest.ordinal}.json`);
  requireCondition((manifest.kind === 'chunk') === (manifest.chunk !== null));
  const prior = state.runs.get(manifest.run);
  if (prior) requireCondition(JSON.stringify(prior.requiredScopes) === JSON.stringify(manifest.snapshot.requiredScopes));
  if (manifest.chunk) {
    requireCondition(manifest.chunk.name === `${prefix}chunks/${manifest.chunk.digest}.json`);
    const chunk = await exact(store, manifest.chunk);
    const items = chunkSchema.parse(JSON.parse(chunk.bytes.toString())).items;
    requireCondition(JSON.stringify(manifest.ranges) === JSON.stringify(ranges(items)));
    let count = BigInt(prior?.v1Count ?? '0');
    let hash = prior?.v1Digest ?? emptyDigest;
    const heads = prior?.heads.slice() ?? [];
    for (const item of items) {
      if (item.kind === 'v1') { count += BigInt(1); hash = addV1(hash, item); }
      if (item.kind === 'head') heads.push(item);
    }
    requireCondition(manifest.snapshot.v1Count === count.toString() && manifest.snapshot.v1Digest === hash
      && JSON.stringify(manifest.snapshot.heads) === JSON.stringify(heads));
    apply(items, state, control);
  } else {
    requireCondition(manifest.v1Count !== null && manifest.v1Digest !== null && manifest.ranges.length === 0);
    requireCondition(manifest.kind !== 'complete' || control.baselineFinalized);
    requireCondition(manifest.v1Count === (state.baseline?.v1Count ?? manifest.snapshot.v1Count) && manifest.v1Digest === (state.baseline?.v1Digest ?? manifest.snapshot.v1Digest));
    if (prior) requireCondition(JSON.stringify(manifest.snapshot) === JSON.stringify(prior));
    else requireCondition(manifest.snapshot.v1Count === '0' && manifest.snapshot.v1Digest === emptyDigest && manifest.snapshot.heads.length === 0 && manifest.snapshot.cursor === null);
  }
  state.runs.set(manifest.run, manifest.snapshot);
  state.pending = manifest.kind === 'chunk' ? manifest : null;
  state.ordinal = manifest.ordinal;
  state.digest = saved.ref.digest;
  state.latestKind = manifest.kind;
  if (manifest.kind === 'complete') state.latestComplete = manifest.createdAt;
  return manifest;
}
function freshState(): State {
  return { ordinal: '0', digest: null, positions: new Map(), inventory: new Map(), baseline: null, pending: null, runs: new Map(), latestComplete: null, latestKind: null };
}
async function recover(store: Store, control: Control, state: State, deadline: number) {
  const prefix = `${archivePrefix(control)}manifests/`;
  let cursor: string | undefined;
  const names = new Set<string>();
  const cursors = new Set<string>();
  let maximum = BigInt(0);
  do {
    if (Date.now() >= deadline) throw new ArchiveFailure('incomplete');
    const page = await store.list(prefix, cursor);
    for (const name of page.names) {
      const ordinal = name.slice(prefix.length).match(/^([1-9][0-9]*)\.json$/)?.[1];
      requireCondition(ordinal);
      names.add(name);
      if (BigInt(ordinal) > maximum) maximum = BigInt(ordinal);
    }
    cursor = page.cursor;
    if (cursor) { requireCondition(!cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor);
  requireCondition(BigInt(names.size) === maximum);
  while (Date.now() < deadline) {
    const next = (BigInt(state.ordinal) + BigInt(1)).toString();
    const saved = await store.read(`${archivePrefix(control)}manifests/${next}.json`);
    if (!saved) { requireCondition(BigInt(next) > maximum); return; }
    await accept(store, saved, state, control);
  }
  throw new ArchiveFailure('incomplete');
}
async function loadBaseline(store: Store, control: Control) {
  let baseline: z.infer<typeof baselineSchema> | null = null;
  if (control.baseline) {
    requireCondition(control.baseline.name.startsWith(`control/${control.environment}/`));
    baseline = baselineSchema.parse(JSON.parse((await exact(store, control.baseline)).bytes.toString()));
    requireCondition(baseline.environment === control.environment && baseline.cutoverId === control.cutoverId);
    const receipt = manifestSchema.parse(JSON.parse((await exact(store, baseline.inventoryReceipt)).bytes.toString()));
    requireCondition(receipt.environment === control.environment && receipt.kind === 'inventory'
      && receipt.v1Count === baseline.v1Count && receipt.v1Digest === baseline.v1Digest);
  }
  return baseline;
}
export async function runArchive(store: Store, source: Source, control: Control, budgetMs = 40_000): Promise<ArchiveResult> {
  const deadline = Date.now() + budgetMs;
  const state = freshState();
  state.baseline = await loadBaseline(store, control);
  await recover(store, control, state, deadline);
  const pending = state.pending;
  const run = pending?.run ?? z.uuid().parse(await source.begin(Object.fromEntries([...state.positions].map(([scope, position]) => [scope, position.sequence])), !control.baselineFinalized));
  const heads = new Map<string, Head>(pending?.snapshot.heads.map(head => [head.scope, head]) ?? []);
  const initialPositions = new Map(state.positions);
  const requiredScopes = pending?.snapshot.requiredScopes ?? [...initialPositions.keys()];
  let cursor: Cursor = pending?.snapshot.cursor ?? null;
  let count = BigInt(pending?.snapshot.v1Count ?? '0');
  let archived = BigInt(0);
  let v1Digest = pending?.snapshot.v1Digest ?? emptyDigest;
  const seenCursors = new Set<string>();
  async function publish(items: Item[] | null, final?: { count: string; digest: string }): Promise<void> {
    while (Date.now() < deadline) {
      const remaining = items?.filter(item => {
        if (item.kind !== 'v2') return true;
        const saved = state.inventory.get(`${item.scope}/${item.sequence}`);
        if (saved) { requireCondition(saved === validateEvent(item)); return false; }
        return true;
      }) ?? null;
      if (remaining) apply(remaining, { ...state, positions: new Map(state.positions), inventory: new Map(state.inventory) }, control);
      let chunk: ObjectRef | null = null;
      if (remaining) {
        const bytes = encode({ schema: 'audit-chunk:1', items: remaining });
        requireCondition(bytes.length <= MAX_BYTES);
        const saved = await store.create(`${archivePrefix(control)}chunks/${sha256(bytes)}.json`, bytes);
        requireCondition(saved.ref.digest === sha256(bytes) && saved.bytes.equals(bytes));
        chunk = saved.ref;
      }
      const ordinal = (BigInt(state.ordinal) + BigInt(1)).toString();
      const candidate: Manifest = {
        schema: 'audit-manifest:1', environment: control.environment, cutoverId: control.cutoverId,
        ordinal, previousDigest: state.digest, run, createdAt: new Date().toISOString(),
        snapshot: { cursor, heads: [...heads.values()], v1Count: count.toString(), v1Digest, requiredScopes },
        kind: final ? (control.baselineFinalized ? 'complete' : 'inventory') : 'chunk', chunk,
        v1Count: final?.count ?? null, v1Digest: final?.digest ?? null, ranges: ranges(remaining ?? []),
      };
      const bytes = encode(candidate);
      requireCondition(bytes.length <= MAX_BYTES);
      const saved = await store.create(`${archivePrefix(control)}manifests/${ordinal}.json`, bytes);
      const winner = await accept(store, saved, state, control);
      await source.cache(state.ordinal, state.digest!);
      if (saved.bytes.equals(bytes)) {
        archived += BigInt(remaining?.filter(item => item.kind !== 'head').length ?? 0);
        return;
      }
      if (winner.run === run) {
        // Two callers may resume the same persisted run. An equivalent page
        // receipt is already committed; never append that v1 page twice.
        if (winner.kind === candidate.kind && JSON.stringify(winner.snapshot) === JSON.stringify(snapshotSchema.parse(candidate.snapshot))) {
          for (const item of remaining ?? []) if (item.kind === 'v2') requireCondition(state.inventory.get(`${item.scope}/${item.sequence}`) === validateEvent(item));
          return;
        }
        // The other caller is further ahead. The next request resumes its cursor.
        throw new ArchiveFailure('incomplete');
      }
      // A different publisher won. Its verified receipt advances state. Replan
      // only this page's unsaved range; never count the losing chunk as saved.
    }
    throw new ArchiveFailure('incomplete');
  }
  do {
    if (Date.now() >= deadline) return { status: 'incomplete', archived: archived.toString() };
    const page = pageSchema.parse(await source.page(run, cursor));
    requireCondition(encode(page).length <= MAX_BYTES);
    requireCondition(!page.more || (page.items.length > 0 && page.cursor !== null));
    if (page.items.length) {
      const last = page.items[page.items.length - 1];
      requireCondition(page.cursor && page.cursor[0] === last.kind && page.cursor[1] === last.scope
        && page.cursor[2] === last.sequence && page.cursor[3] === (last.kind === 'head' ? '00000000-0000-0000-0000-000000000000' : last.id));
      const cursorKey = JSON.stringify(page.cursor);
      requireCondition(!seenCursors.has(cursorKey));
      seenCursors.add(cursorKey);
    }
    // Validate before any chunk creation. Historical v1 hash anomalies are
    // preserved, not repaired or interpreted as a historical pass.
    const eligible = control.baselineFinalized ? page.items : page.items.filter(item => item.kind === 'v1');
    for (const item of eligible) {
      if (item.kind === 'head') {
        requireCondition(control.baselineFinalized && item.cutoverId === control.cutoverId && !heads.has(item.scope));
        heads.set(item.scope, item);
        const old = initialPositions.get(item.scope);
        if (old) requireCondition(BigInt(item.sequence) >= BigInt(old.sequence)
          && (item.sequence !== old.sequence || item.hash === old.hash));
      } else {
        validateEvent(item);
        if (item.kind === 'v1') { count += BigInt(1); v1Digest = addV1(v1Digest, item); }
        else {
          const head = heads.get(item.scope);
          requireCondition(head && item.cutoverId === head.cutoverId && BigInt(item.sequence) <= BigInt(head.sequence));
          if (item.sequence === head.sequence) requireCondition(item.hash === head.hash);
        }
      }
    }
    cursor = page.cursor;
    if (page.items.length) await publish(eligible);
    if (!page.more) break;
  } while (true);
  for (const scope of requiredScopes) requireCondition(heads.has(scope));
  for (const head of heads.values()) {
    const saved = state.positions.get(head.scope);
    requireCondition(saved && BigInt(saved.sequence) >= BigInt(head.sequence));
  }
  requireCondition(!control.baselineFinalized || count === BigInt(0));
  const final = state.baseline ? { count: state.baseline.v1Count, digest: state.baseline.v1Digest } : { count: count.toString(), digest: v1Digest };
  await publish(null, final);
  const status = control.baselineFinalized ? 'complete' : 'inventory';
  await source.record(status, archived.toString());
  return { status, archived: archived.toString() };
}

export async function archiveHealth(store: Store, control: Control, now = Date.now(), budgetMs = 20_000) {
  const state = freshState();
  state.baseline = await loadBaseline(store, control);
  await recover(store, control, state, now + budgetMs);
  const start = Date.parse(state.latestComplete ?? control.monitoringStartedAt);
  requireCondition(Number.isFinite(start) && start <= now);
  const stale = now - start > 26 * 60 * 60 * 1000;
  const incomplete = state.latestKind !== 'complete';
  return { critical: stale || incomplete, category: stale ? 'archive_stale' : incomplete ? 'archive_incomplete' : 'archive_current' };
}

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { archiveHealth, archivePrefix, loadControl, readPreservedArchive, runArchive, type Manifest } from './publisher';
import { encode, sha256, type Control, type Cursor, type Event, type Head, type Item, type ObjectRef, type Source, type Store } from './contracts';

const cutover = '15000000-0000-4000-8000-000000000001';
class MemoryStore implements Store {
  objects = new Map<string, { ref: ObjectRef; bytes: Buffer }>();
  generations = BigInt('9007199254740993');
  beforeCreate?: (name: string) => Promise<void>;
  async list(prefix: string) { return { names: [...this.objects.keys()].filter(name => name.startsWith(prefix)) }; }
  async read(name: string, generation?: string) {
    const item = this.objects.get(name);
    return item && (!generation || item.ref.generation === generation) ? item : null;
  }
  async create(name: string, bytes: Buffer) {
    await this.beforeCreate?.(name);
    if (!this.objects.has(name)) this.objects.set(name, { bytes, ref: { name, generation: (++this.generations).toString(), digest: sha256(bytes), size: String(bytes.length) } });
    return this.objects.get(name)!;
  }
}
function v1(overrides: Partial<Event> = {}): Event {
  const event: Event = {
    kind: 'v1', version: 1, scope: 'global', sequence: '0', id: randomUUID(), eventId: randomUUID(), hash: null,
    previousHash: null, cutoverId: null, canonical: null, inventory: '', ...overrides,
  };
  const inventory = ['audit-inventory:2', event.id, event.eventId, null, null, 'fixture', 'audit', null, 'success', null, null,
    null, '2026-10-24T00:00:00.123456Z', { text: '改行\n日本語', empty: '', nil: null }, null, null, event.previousHash, event.hash, event.version, null, null, null];
  event.inventory = encode(inventory).toString('base64');
  return event;
}
function v2(sequence: string, previousHash: string): Event {
  const event = v1({ kind: 'v2', version: 2, sequence, cutoverId: cutover, previousHash });
  const inv = JSON.parse(Buffer.from(event.inventory, 'base64').toString());
  inv[19] = 'global'; inv[20] = sequence; inv[21] = cutover;
  const bytes = encode([2, cutover, 'global', sequence, event.id, event.eventId, ...inv.slice(3, 16), previousHash]);
  event.canonical = bytes.toString('base64'); event.hash = sha256(bytes); inv[17] = event.hash;
  event.inventory = encode(inv).toString('base64');
  return event;
}
const provisional = (): Control => ({ schema: 'audit-control:1', environment: 'local', cutoverId: 'pre-cutover', baselineFinalized: false, baseline: null, monitoringStartedAt: new Date().toISOString() });
async function enabled(store: MemoryStore, recomputationSettingsEvidence: string | null = null): Promise<Control> {
  const receipt: Manifest = { schema: 'audit-manifest:1', environment: 'local', cutoverId: 'pre-cutover', ordinal: '1', previousDigest: null, run: randomUUID(), createdAt: new Date().toISOString(), kind: 'inventory', chunk: null, ranges: [], snapshot: { cursor: null, heads: [], requiredScopes: [], v1Count: '0', v1Digest: sha256(Buffer.alloc(0)) }, v1Count: '0', v1Digest: sha256(Buffer.alloc(0)) };
  const saved = await store.create('archive/local/pre-cutover/manifests/1.json', encode(receipt));
  const prefix = `control/local/${cutover}/`;
  const classification = await store.create(`${prefix}classification.json`,encode({ schema:'audit-v1-classification:1',historicalVerdict:'unresolved',v1Count:'0',v1Digest:receipt.v1Digest,scopes:[],counts:{},anomalyParts:[],evidenceDigest:'b'.repeat(64),recomputationSettingsEvidence }));
  const baseline = await store.create(`${prefix}baseline.json`, encode({ schema: 'audit-baseline:1', environment: 'local', cutoverId: cutover, v1Count: '0', v1Digest: receipt.v1Digest, inventoryReceipt: saved.ref, historicalVerdict: 'unresolved',classification:classification.ref,evidenceDigest:'b'.repeat(64),boundary:{cutoverId:cutover,v1Count:'0',v1Digest:receipt.v1Digest,at:'2026-01-01T00:00:00.000000Z'} }));
  return { ...provisional(), cutoverId: cutover, baselineFinalized: true, baseline: baseline.ref };
}
function sourceFor(items: Item[], failCache = false): Source & { caches: string[]; begins: number } {
  let index = 0;
  return {
    caches: [], begins: 0, async record() {},
    async begin() { this.begins++; index = 0; return randomUUID(); },
    async page(run, cursor) {
      expect(run).toMatch(/^[0-9a-f-]{36}$/);
      if (cursor) {
        const found = items.findIndex(item => item.kind === cursor[0] && item.scope === cursor[1] && item.sequence === cursor[2] && (item.kind === 'head' || item.id === cursor[3]));
        if (found >= 0) index = found + 1;
      }
      const pageItems = items.slice(index, index + 200); index += pageItems.length;
      const last = pageItems.at(-1);
      const nextCursor: Cursor = last ? [last.kind, last.scope, last.sequence, last.kind === 'head' ? '00000000-0000-0000-0000-000000000000' : last.id] : cursor;
      return { items: pageItems, cursor: nextCursor, more: index < items.length };
    },
    async cache(ordinal) { if (failCache) throw new Error('private DB failure'); this.caches.push(ordinal); },
  };
}
function events(count: number): Item[] {
  let previous = `GENESIS:v2:${cutover}:global`;
  const rows: Event[] = [];
  for (let i = 1; i <= count; i++) { const event = v2(String(i), previous); rows.push(event); previous = event.hash!; }
  const head: Head = { kind: 'head', scope: 'global', sequence: String(count), hash: previous, cutoverId: cutover };
  return [head, ...rows];
}
function manifests(store: MemoryStore, control: Control) {
  return [...store.objects.entries()].filter(([name]) => name.startsWith(`${archivePrefix(control)}manifests/`)).map(([, value]) => JSON.parse(value.bytes.toString()) as Manifest);
}

describe('immutable audit preservation', () => {
  it('requires independently pinned settings before evidence-backed recomputation', async () => {
    const { inspectPreservation } = await import('@/utils/auditVerification/inspect');
    const store=new MemoryStore(), evidence='a'.repeat(64), control=await enabled(store,evidence), rows=events(1);
    const pin=await store.create('control/local/root.json',encode(control));
    await runArchive(store,sourceFor(rows),control);
    const snapshot=sourceFor(rows), source={begin:() => snapshot.begin({},false),page:(run:string,cursor:Cursor) => snapshot.page(run,cursor),recompute:async()=>[]};
    await expect(inspectPreservation(store,pin.ref,'local',source)).rejects.toMatchObject({category:'incomplete'});
    const settings=await store.create(`control/local/${cutover}/recompute-settings.json`,encode({schema:'audit-v1-recompute-settings:1',environment:'local',cutoverId:cutover,timeZone:'UTC',dateStyle:'ISO, MDY',settingsEvidenceDigest:evidence}));
    await expect(inspectPreservation(store,pin.ref,'local',source,10000,settings.ref)).resolves.toMatchObject({status:'evidence_only',recomputedRows:'0',historicalVerdict:'unresolved'});
  });
  it('connects pinned archive to all snapshot pages without issuing a success verdict', async () => {
    const { inspectPreservation } = await import('@/utils/auditVerification/inspect');
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(3);
    const pinned = await store.create('control/local/root.json',encode(control));
    await runArchive(store,sourceFor(rows),control);
    const newer = v2('4',(rows.at(-1) as Event).hash!);
    const snapshot = sourceFor([{ ...(rows[0] as Head),sequence:'4',hash:newer.hash! },...rows.slice(1),newer]);
    const source = { begin:() => snapshot.begin({},false), page:(run: string,cursor: Cursor) => snapshot.page(run,cursor) };
    const result=await inspectPreservation(store,pinned.ref,'local',source);
    expect(result).toMatchObject({status:'evidence_only',archivedRows:'3',newerRows:'1',historicalVerdict:'unresolved'});
    expect(result.targetManifest).toEqual((await store.read(`${archivePrefix(control)}manifests/${result.targetOrdinal}.json`))?.ref);
    const missing = sourceFor([]);
    await expect(inspectPreservation(store,pinned.ref,'local',{begin:() => missing.begin({},false),page:(run,cursor) => missing.page(run,cursor)})).rejects.toMatchObject({category:'mismatch'});
    await expect(inspectPreservation(store,pinned.ref,'local',{begin:() => new Promise<string>(() => {}),page:async () => null},100)).rejects.toMatchObject({category:'incomplete'});
  });

  it('runs real evidence checks but records incomplete while historical v1 remains unresolved', async () => {
    const { runVerification } = await import('@/utils/auditVerification/run');
    const archive=new MemoryStore(), receipts=new MemoryStore(), control=await enabled(archive), rows=events(1);
    const pin=await archive.create('control/local/root.json',encode(control));
    await runArchive(archive,sourceFor(rows),control);
    const snapshot=sourceFor(rows), source={begin:() => snapshot.begin({},false),page:(run:string,cursor:Cursor) => snapshot.page(run,cursor)};
    const result=await runVerification({environment:'local',runId:'123',attempt:'1',createdAt:'2026-01-01T00:00:00Z'},archive,receipts,pin.ref,source);
    expect(result.status).toBe('incomplete');
    const recorded=JSON.parse((await receipts.read(result.receipt.name))!.bytes.toString());
    const target=manifests(archive,control).at(-1)!;
    expect(recorded).toMatchObject({status:'incomplete',runId:'123',target:{cutoverId:cutover,ordinal:target.ordinal,ref:(await archive.read(`${archivePrefix(control)}manifests/${target.ordinal}.json`))!.ref}});
    expect(snapshot.begins).toBe(1);
  });

  it('classifies malformed pinned control as mismatch before starting a snapshot', async () => {
    const { inspectPreservation } = await import('@/utils/auditVerification/inspect');
    for (const bytes of [Buffer.from('{'),encode({schema:'audit-control:1'})]) {
      const store=new MemoryStore(), pin=await store.create('control/local/root.json',bytes);
      let begins=0;
      const source={begin:async () => { begins++; return randomUUID(); },page:async () => null};
      await expect(inspectPreservation(store,pin.ref,'local',source)).rejects.toMatchObject({category:'mismatch'});
      expect(begins).toBe(0);
    }
  });

  it('bounds a stalled external archive read before starting a snapshot', async () => {
    const { inspectPreservation } = await import('@/utils/auditVerification/inspect');
    const store=new MemoryStore(), pin={name:'control/local/root.json',generation:'1',size:'1',digest:'a'.repeat(64)};
    store.read=async () => new Promise(() => {});
    let begins=0; const source={begin:async () => { begins++; return randomUUID(); },page:async () => null};
    vi.useFakeTimers();
    try {
      const result=expect(inspectPreservation(store,pin,'local',source)).rejects.toMatchObject({category:'incomplete'});
      await vi.advanceTimersByTimeAsync(40_001);
      await result;
      expect(begins).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('rejects bytes that do not match the pinned control reference', async () => {
    const store = new MemoryStore(); const control = await enabled(store);
    const pinned = await store.create('control/local/root.json',encode(control));
    store.objects.set(pinned.ref.name,{ ref:pinned.ref,bytes:Buffer.from('{}') });
    await expect(readPreservedArchive(store,pinned.ref,'local')).rejects.toThrow();
  });
  it('replays pinned external evidence and refuses missing or unfinalized references', async () => {
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(3);
    const pinned = await store.create('control/local/root.json', encode(control));
    await runArchive(store, sourceFor(rows), control);
    const evidence = await readPreservedArchive(store, pinned.ref, 'local');
    expect(evidence.positions.get('global')).toEqual({ sequence:'3', hash:(rows.at(-1) as Event).hash });
    expect(evidence.inventory.size).toBe(3);
    const target=await store.read(`${archivePrefix(control)}manifests/${evidence.ordinal}.json`);
    expect(evidence.manifestRef).toEqual(target?.ref);
    expect(BigInt(evidence.manifestRef.generation)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(evidence.manifestRef.digest).toBe(evidence.manifestDigest);
    await expect(readPreservedArchive(store, { ...pinned.ref, digest:'f'.repeat(64) }, 'local')).rejects.toThrow();
    await expect(readPreservedArchive(store, pinned.ref, 'staging')).rejects.toThrow();
    const provisionalPin = await store.create('control/local/provisional.json', encode(provisional()));
    await expect(readPreservedArchive(store, provisionalPin.ref, 'local')).rejects.toThrow();
    store.objects.delete(`${archivePrefix(control)}manifests/1.json`);
    await expect(readPreservedArchive(store, pinned.ref, 'local')).rejects.toThrow();
  });

  it('refuses to start a snapshot if the recovered manifest generation cannot be re-read', async () => {
    const { inspectPreservation } = await import('@/utils/auditVerification/inspect');
    const store=new MemoryStore(), control=await enabled(store), rows=events(1);
    const pin=await store.create('control/local/root.json',encode(control));
    await runArchive(store,sourceFor(rows),control);
    const target=manifests(store,control).at(-1)!;
    const name=`${archivePrefix(control)}manifests/${target.ordinal}.json`;
    const read=store.read.bind(store);
    store.read=async (key,generation) => key===name && generation ? null : read(key,generation);
    let begins=0;
    const snapshot=sourceFor(rows), source={begin:() => { begins++; return snapshot.begin({},false); },page:(run:string,cursor:Cursor) => snapshot.page(run,cursor)};
    await expect(inspectPreservation(store,pin.ref,'local',source)).rejects.toMatchObject({category:'mismatch'});
    expect(begins).toBe(0);
  });

  it('rejects a manifest that is replaced between recovery and generation recheck', async () => {
    const store=new MemoryStore(), control=await enabled(store), rows=events(1);
    const pin=await store.create('control/local/root.json',encode(control));
    await runArchive(store,sourceFor(rows),control);
    const target=manifests(store,control).at(-1)!;
    const name=`${archivePrefix(control)}manifests/${target.ordinal}.json`;
    const read=store.read.bind(store); let latestReads=0;
    store.read=async (key,generation) => {
      const item=await read(key,generation);
      if (key===name && !generation && ++latestReads===2 && item) return {...item,ref:{...item.ref,generation:(BigInt(item.ref.generation)+BigInt(1)).toString()}};
      return item;
    };
    await expect(readPreservedArchive(store,pin.ref,'local')).rejects.toMatchObject({category:'mismatch'});
  });

  it('records a mismatch and pinned target when the manifest changes during DB reading', async () => {
    const { runVerification } = await import('@/utils/auditVerification/run');
    const store=new MemoryStore(), receipts=new MemoryStore(), control=await enabled(store), rows=events(1);
    const pin=await store.create('control/local/root.json',encode(control));
    await runArchive(store,sourceFor(rows),control);
    const target=manifests(store,control).at(-1)!;
    const name=`${archivePrefix(control)}manifests/${target.ordinal}.json`;
    const original=(await store.read(name))!.ref;
    const snapshot=sourceFor(rows);
    const source={begin:() => snapshot.begin({},false),page:async (run:string,cursor:Cursor) => {
      const item=(await store.read(name))!;
      store.objects.set(name,{...item,ref:{...item.ref,generation:(BigInt(item.ref.generation)+BigInt(1)).toString()}});
      return snapshot.page(run,cursor);
    }};
    const result=await runVerification({environment:'local',runId:'124',attempt:'1',createdAt:'2026-01-01T00:00:00Z'},store,receipts,pin.ref,source);
    expect(result.status).toBe('mismatch');
    expect(JSON.parse((await receipts.read(result.receipt.name))!.bytes.toString())).toMatchObject({status:'mismatch',target:{ref:original}});
  });

  it('preserves every null-hash/global v1 row beyond 500 with identical microsecond timestamps; remains provisional', async () => {
    const store = new MemoryStore(); const control = provisional();
    const rows = Array.from({ length: 1001 }, () => v1()).sort((a, b) => a.id.localeCompare(b.id));
    const result = await runArchive(store, sourceFor(rows), control);
    expect(result).toEqual({ status: 'inventory', archived: '1001' });
    const receipts = manifests(store, control);
    expect(receipts.at(-1)?.v1Count).toBe('1001');
    let hash = sha256(Buffer.alloc(0));
    for (const row of rows) hash = sha256(Buffer.concat([Buffer.from(hash, 'hex'), encode([row.id, sha256(Buffer.from(row.inventory, 'base64'))])]));
    expect(receipts.at(-1)?.v1Digest).toBe(hash);
    expect(receipts.every(r => r.kind !== 'complete')).toBe(true);
    expect((await archiveHealth(store, control)).critical).toBe(true);
  });
  it('archives 1001 v2 events to fixed heads and recovers external progress without trusting a DB cache', async () => {
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(1001);
    expect((await runArchive(store, sourceFor(rows), control)).archived).toBe('1001');
    expect((await runArchive(store, sourceFor(rows), control)).archived).toBe('0');
    expect((await archiveHealth(store, control)).critical).toBe(false);
    // A later commit is seen in the next run, without a timestamp lower bound.
    const next = v2('1002', (rows.at(-1) as Event).hash!);
    const updated: Item[] = [{ ...(rows[0] as Head), sequence: '1002', hash: next.hash! }, ...rows.slice(1), next];
    expect((await runArchive(store, sourceFor(updated), control)).archived).toBe('1');
  });
  it('recovers manifest commit followed by DB cache failure; orphan chunks never count as receipts', async () => {
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(3);
    await store.create(`${archivePrefix(control)}chunks/orphan.json`, encode({ secret: 'orphan' }));
    await expect(runArchive(store, sourceFor(rows, true), control)).rejects.toThrow();
    expect(manifests(store, control)).toHaveLength(1);
    expect((await runArchive(store, sourceFor(rows), control)).archived).toBe('0');
    expect(store.objects.has(`${archivePrefix(control)}chunks/orphan.json`)).toBe(true);
  });
  it('resumes a persisted run and v1 digest from its external cursor after interruption', async () => {
    const store = new MemoryStore(); const control = provisional();
    const rows = Array.from({ length: 501 }, () => v1()).sort((a,b) => a.id.localeCompare(b.id));
    const source = sourceFor(rows); const page = source.page.bind(source); let calls = 0;
    source.page = async (run, cursor) => { if (++calls === 2) throw new Error('budget interrupted'); return page(run, cursor); };
    await expect(runArchive(store, source, control)).rejects.toThrow();
    expect(manifests(store, control).at(-1)?.snapshot.v1Count).toBe('200');
    const resumed = sourceFor(rows);
    expect((await runArchive(store, resumed, control)).status).toBe('inventory');
    expect(resumed.begins).toBe(0);
    expect(manifests(store, control).at(-1)?.v1Count).toBe('501');
  });
  it('does not duplicate v1 when two publishers resume the same run', async () => {
    const store = new MemoryStore(); const control = provisional();
    const rows = Array.from({ length: 201 }, () => v1()).sort((a,b) => a.id.localeCompare(b.id));
    const initial = sourceFor(rows); const firstPage = initial.page.bind(initial); let calls = 0;
    initial.page = async (run,cursor) => { if (++calls === 2) throw new Error('interrupted'); return firstPage(run,cursor); };
    await expect(runArchive(store,initial,control)).rejects.toThrow();
    let release!: () => void; const barrier = new Promise<void>(resolve => { release=resolve; }); let arrivals=0;
    store.beforeCreate = async name => { if(name===`${archivePrefix(control)}manifests/2.json`) { if(++arrivals===2) release(); await barrier; } };
    const results = await Promise.all([runArchive(store,sourceFor(rows),control),runArchive(store,sourceFor(rows),control)]);
    expect(results.every(result=>result.status==='inventory')).toBe(true);
    expect(manifests(store,control).at(-1)?.v1Count).toBe('201');
    expect(manifests(store,control)).toHaveLength(3);
  });
  it('keeps two concurrent publishers on one fixed ordinal series and reuses the winner', async () => {
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(4);
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); let arrivals = 0;
    store.beforeCreate = async name => {
      if (name === `${archivePrefix(control)}manifests/1.json`) { arrivals++; if (arrivals === 2) release(); await barrier; }
    };
    const results = await Promise.all([runArchive(store, sourceFor(rows), control), runArchive(store, sourceFor(rows), control)]);
    expect(results.every(r => r.status === 'complete')).toBe(true);
    expect(results.reduce((sum, r) => sum + BigInt(r.archived), BigInt(0))).toBe(BigInt(4));
    const receipts = manifests(store, control);
    expect(receipts.map(m => m.ordinal)).toEqual(receipts.map((_, i) => String(i + 1)));
    expect((await archiveHealth(store, control)).critical).toBe(false);
  });
  it('refuses missing scopes, stale heads, tampered bytes, gaps, or unapproved GENESIS before commit', async () => {
    for (const mutate of [
      (rows: Item[]) => rows.slice(2),
      (rows: Item[]) => [{ ...(rows[0] as Head), cutoverId: randomUUID() }, ...rows.slice(1)],
      (rows: Item[]) => [rows[0], { ...(rows[1] as Event), inventory: 'dGFtcGVy' }, ...rows.slice(2)],
      (rows: Item[]) => [rows[0], ...rows.slice(2)],
    ]) {
      const store = new MemoryStore(); const control = await enabled(store);
      await expect(runArchive(store, sourceFor(mutate(events(3))), control)).rejects.toThrow();
      expect(manifests(store, control)).toHaveLength(0);
    }
    const store = new MemoryStore(); const control = await enabled(store); const rows = events(3);
    await runArchive(store, sourceFor(rows), control);
    await expect(runArchive(store, sourceFor([]), control)).rejects.toThrow();
    await expect(runArchive(store, sourceFor([{ ...(rows[0] as Head), sequence: '2' }, ...rows.slice(1, 3)]), control)).rejects.toThrow();
  });
  it('does not extend a run snapshot to chase a publisher audit event', async () => {
    const store = new MemoryStore(); const control = await enabled(store); const source = sourceFor(events(501));
    await runArchive(store, source, control);
    expect(source.begins).toBe(1);
  });
  it('generates a provisional v1 inventory after G even while unactivated v2 rows exist', async () => {
    const store = new MemoryStore();
    expect(await runArchive(store, sourceFor([...events(2), v1()]), provisional())).toEqual({ status: 'inventory', archived: '1' });
    const chunks = [...store.objects.values()].filter(object => object.ref.name.includes('/chunks/'));
    expect(chunks.flatMap(object => JSON.parse(object.bytes.toString()).items).every((item: Item) => item.kind === 'v1')).toBe(true);
  });
  it('rejects a missing receipt when a later ordinal is still present', async () => {
    const store = new MemoryStore(); const control = await enabled(store);
    await runArchive(store, sourceFor(events(3)), control);
    store.objects.delete(`${archivePrefix(control)}manifests/1.json`);
    await expect(runArchive(store, sourceFor([]), control)).rejects.toThrow();
  });
  it('pins control outside the DB and rejects a different environment/generation/digest', async () => {
    const store = new MemoryStore(); const control = provisional();
    const saved = await store.create('control/local/root.json', encode(control));
    expect(await loadControl(store, saved.ref, 'local')).toEqual(control);
    for (const ref of [{ ...saved.ref, digest: '0'.repeat(64) }, { ...saved.ref, generation: '9007199254740992' }]) {
      await expect(loadControl(store, ref, 'local')).rejects.toThrow();
    }
    await expect(loadControl(store, saved.ref, 'production')).rejects.toThrow();
  });
  it('detects no-success after 26h and budget exhaustion, without claiming completion', async () => {
    const store = new MemoryStore(); const control = provisional();
    control.monitoringStartedAt = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
    expect((await archiveHealth(store, control)).category).toBe('archive_stale');
    await expect(runArchive(store, sourceFor([]), control, -1)).rejects.toMatchObject({ category: 'incomplete' });
  });
  it('retains exact large decimal sequence/generation strings without Number rounding', async () => {
    const store = new MemoryStore(); const control = provisional();
    const saved = await store.create('control/local/root.json', encode(control));
    expect(BigInt(saved.ref.generation)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect((await loadControl(store, saved.ref, 'local')).cutoverId).toBe('pre-cutover');
  });
  it('rejects a nonadvancing or incorrect returned cursor', async () => {
    const store = new MemoryStore(); const source = sourceFor([v1()]);
    source.page = async () => ({ items: [v1()], cursor: null, more: true });
    await expect(runArchive(store, source, provisional())).rejects.toThrow();
  });
});

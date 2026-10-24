import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { issueControl } from '../../../scripts/audit/cutover-control.mjs';
import { runArchive, type Manifest } from '../auditArchive/publisher';
import { encode, sha256, type Control, type Event, type ObjectRef, type Source, type Store } from '../auditArchive/contracts';

class MemoryStore implements Store {
  objects = new Map<string, { bytes: Buffer; ref: ObjectRef }>();
  generation = BigInt('9007199254740993');
  async read(name: string, generation?: string) {
    const saved = this.objects.get(name);
    return saved && (!generation || saved.ref.generation === generation) ? saved : null;
  }
  async list(prefix: string) { return { names: [...this.objects.keys()].filter(name => name.startsWith(prefix)) }; }
  async create(name: string, bytes: Buffer) {
    if (!this.objects.has(name)) this.objects.set(name, { bytes, ref: { name, generation: String(++this.generation), size: String(bytes.length), digest: sha256(bytes) } });
    return this.objects.get(name)!;
  }
}

it('finalizes the exact B inventory and supplies a baseline/control the unchanged B publisher accepts', async () => {
  const store = new MemoryStore();
  const provisional: Control = { schema: 'audit-control:1', environment: 'local', cutoverId: 'pre-cutover', baselineFinalized: false, baseline: null, monitoringStartedAt: '2026-10-25T00:00:00.000Z' };
  const previous = await store.create('control/local/preparation.json', encode(provisional));
  const id = randomUUID(), eventId = randomUUID();
  const inventory = ['audit-inventory:2', id, eventId, null, null, 'fixture', 'test', null, 'success', null, null,
    null, '2026-10-25T00:00:00.123456Z', {}, null, null, null, null, 1, null, null, null];
  const row: Event = { kind: 'v1', version: 1, scope: 'global', sequence: '0', id, eventId, hash: null,
    previousHash: null, cutoverId: null, canonical: null, inventory: encode(inventory).toString('base64') };
  const source: Source = {
    async begin() { return randomUUID(); },
    async page() { return { items: [row], more: false, cursor: ['v1', 'global', '0', id] }; },
    async cache() {}, async record() {},
  };
  expect((await runArchive(store, source, provisional)).status).toBe('inventory');
  const receipts = [...store.objects.values()].filter(object => object.ref.name.includes('/manifests/'));
  const final = JSON.parse(receipts.at(-1)!.bytes.toString()) as Manifest;
  const cutoverId = randomUUID();
  const boundaryAt = new Date(Date.now() - 2000).toISOString();
  const snapshotStartedAt = new Date(Date.now() - 1000).toISOString();
  const pins = await issueControl(store, {
    schema: 'audit-cutover-plan:1', environment: 'local', cutoverId, evidenceDigest: '1'.repeat(64),
    boundary: { cutoverId, v1Count: '1', at: boundaryAt }, inventoryRun: final.run,
    snapshotStartedAt, monitoringStartedAt: final.createdAt,
    previousControl: previous.ref, inventoryReceipts: receipts.map(object => object.ref),
    evidence: Object.fromEntries(['aDeployment', 'bDeployment', 'backupFreshness', 'oldJobsDrained', 'legacyExportsReviewed', 'migrationApplied', 'approval'].map(key => [key, '2'.repeat(64)])),
  });
  expect(pins.enabled).toBe(false);
  const control = JSON.parse((await store.read(pins.control.name))!.bytes.toString()) as Control;
  const emptySource: Source = {
    ...source, async page() { return { items: [], cursor: null, more: false }; },
    async begin(positions, includeV1) { expect(positions).toEqual({}); expect(includeV1).toBe(false); return randomUUID(); },
  };
  expect(await runArchive(store, emptySource, control)).toEqual({ status: 'complete', archived: '0' });
  const baseline = JSON.parse((await store.read(pins.baseline.name))!.bytes.toString());
  expect(baseline.v1Digest).toBe(final.v1Digest);
  expect(baseline.historicalVerdict).toBe('unresolved');
});

import { ArchiveFailure, decodeBase64, encode, itemSchema, requireCondition, sha256, type Head, type Item } from '@/utils/auditArchive/contracts';

import { LegacyGraph } from './legacyGraph';

type Position = { sequence: bigint; hash: string; cutoverId: string };

// This validates only the DB snapshot's v2 chain. It is deliberately not a
// verification verdict: v1, external inventory, freshness and a receipt still
// have to be checked independently before a run can succeed.
export class SnapshotChain {
  private readonly heads = new Map<string, Head>();
  private readonly positions = new Map<string, Position>();
  private readonly ids = new Set<string>();
  private readonly eventIds = new Set<string>();
  private v1 = BigInt(0);
  private v1Digest = sha256(Buffer.alloc(0));
  private lastV1: string | null = null;
  private readonly inventory = new Map<string, string>();
  private readonly legacy = new LegacyGraph();

  accept(raw: unknown): Item {
    let item: Item;
    try { item = itemSchema.parse(raw); } catch { throw new ArchiveFailure('mismatch'); }
    if (item.kind === 'head') {
      requireCondition(!this.heads.has(item.scope));
      this.heads.set(item.scope, item);
      return item;
    }
    requireCondition(!this.ids.has(item.id) && !this.eventIds.has(item.eventId));
    this.ids.add(item.id);
    this.eventIds.add(item.eventId);
    let inventory: unknown;
    try { inventory = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(item.inventory))); } catch { throw new ArchiveFailure('mismatch'); }
    requireCondition(Array.isArray(inventory) && inventory.length === 22 && inventory[0] === 'audit-inventory:2'
      && inventory[1] === item.id && inventory[2] === item.eventId && inventory[17] === item.hash
      && inventory[16] === item.previousHash && inventory[18] === item.version);
    if (item.kind === 'v1') {
      requireCondition(item.version === 1 && item.sequence === '0' && item.canonical === null
        && item.cutoverId === null && inventory[19] === null && inventory[20] === null && inventory[21] === null
        && item.scope === (inventory[3] === null ? 'global' : `org:${inventory[3]}`));
      const key = `${item.scope}/${item.id}`;
      requireCondition(this.lastV1 === null || this.lastV1 < key);
      this.lastV1 = key;
      this.legacy.accept(item);
      this.v1++;
      this.v1Digest = sha256(Buffer.concat([Buffer.from(this.v1Digest, 'hex'), encode([item.id, sha256(decodeBase64(item.inventory))])]));
      return item;
    }
    requireCondition(item.version === 2 && item.canonical !== null && item.cutoverId !== null && item.hash !== null);
    const bytes = decodeBase64(item.canonical);
    let canonical: unknown;
    try { canonical = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ArchiveFailure('mismatch'); }
    const inventoryOrder = [18,21,19,20,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
    requireCondition(Array.isArray(canonical) && canonical.length === inventoryOrder.length
      && inventoryOrder.every((index, i) => JSON.stringify(canonical[i]) === JSON.stringify(inventory[index]))
      && canonical[1] === item.cutoverId && canonical[2] === item.scope && canonical[3] === item.sequence
      && item.scope === (inventory[3] === null ? 'global' : `org:${inventory[3]}`)
      && sha256(bytes) === item.hash);
    const prior = this.positions.get(item.scope) ?? { sequence: BigInt(0), hash: `GENESIS:v2:${item.cutoverId}:${item.scope}`, cutoverId: item.cutoverId };
    requireCondition(prior.cutoverId === item.cutoverId && BigInt(item.sequence) === prior.sequence + BigInt(1) && item.previousHash === prior.hash);
    this.positions.set(item.scope, { sequence: BigInt(item.sequence), hash: item.hash, cutoverId: item.cutoverId });
    this.inventory.set(`${item.scope}/${item.sequence}`, sha256(decodeBase64(item.inventory)));
    return item;
  }

  finish() {
    requireCondition(this.heads.size === this.positions.size);
    for (const [scope, head] of this.heads) {
      const position = this.positions.get(scope);
      requireCondition(position && position.sequence.toString() === head.sequence && position.hash === head.hash && position.cutoverId === head.cutoverId);
    }
    return { v1Count: this.v1.toString(), v1Digest: this.v1Digest, legacyFindings: this.legacy.finish(), legacyIdentities: this.legacy.identities(), legacyRows: this.legacy.recomputationRows(), heads: new Map(this.heads), inventory: new Map(this.inventory) };
  }
}

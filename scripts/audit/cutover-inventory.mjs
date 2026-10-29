// Offline classifier for generation-pinned B inventory bytes. Never changes rows
// or derives a new chain from timestamp/UUID order. Reports remain unresolved.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function check(value) { if (!value) throw new Error('cutover_evidence_mismatch'); }
export function readInventory(items) {
  const seen = new Set();
  return items.map(item => {
    check(item.kind === 'v1' && typeof item.inventory === 'string');
    const raw = Buffer.from(item.inventory, 'base64');
    check(raw.toString('base64') === item.inventory);
    const row = JSON.parse(raw.toString('utf8'));
    check(Array.isArray(row) && row.length === 22 && row[0] === 'audit-inventory:2'
      && uuidPattern.test(row[1]) && row[1] === item.id && !seen.has(row[1])
      && row[18] === 1 && row.slice(19).every(value => value === null)
      && (row[3] === null || uuidPattern.test(row[3]))
      && (row[16] === null || typeof row[16] === 'string')
      && (row[17] === null || typeof row[17] === 'string'));
    seen.add(row[1]);
    return { id: row[1], scope: row[3] === null ? 'global' : `org:${row[3]}`,
      previous: row[16], hash: row[17], inventoryDigest: sha256(raw) };
  });
}
export function inventorySummary(rows) {
  let digest = sha256(Buffer.alloc(0));
  const scopes = new Map();
  const sorted = [...rows].sort((a,b) => a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const row of sorted) {
    digest = sha256(Buffer.concat([Buffer.from(digest,'hex'), Buffer.from(JSON.stringify([row.id,row.inventoryDigest]))]));
    scopes.set(row.scope, (scopes.get(row.scope) ?? 0n) + 1n);
  }
  return { v1Count: String(rows.length), v1Digest: digest,
    scopes: [...scopes].map(([scope,count]) => ({ scope, count: String(count) })) };
}
export function classifyInventory(items, recomputation = null) {
  const rows = readInventory(items);
  const findings = new Map(rows.map(row => [row.id,new Set()]));
  const scopes = new Map();
  for (const row of rows) {
    if (!scopes.has(row.scope)) scopes.set(row.scope,[]);
    scopes.get(row.scope).push(row);
    if (row.hash === null || row.previous === null) findings.get(row.id).add('null');
    if (row.hash !== null && !hashPattern.test(row.hash)) findings.get(row.id).add('invalid_hash');
  }
  for (const group of scopes.values()) {
    const byHash = new Map(), children = new Map();
    for (const row of group) {
      if (row.hash !== null) {
        if (!byHash.has(row.hash)) byHash.set(row.hash,[]);
        byHash.get(row.hash).push(row);
      }
      if (row.previous !== null) {
        if (!children.has(row.previous)) children.set(row.previous,[]);
        children.get(row.previous).push(row);
      }
    }
    for (const duplicates of byHash.values()) if (duplicates.length > 1)
      for (const row of duplicates) findings.get(row.id).add('duplicate_hash');
    const roots = children.get('GENESIS') ?? [];
    if (roots.length > 1) for (const row of roots) findings.get(row.id).add('multiple_genesis');
    for (const [previous,branches] of children) if (previous !== 'GENESIS' && branches.length > 1)
      for (const row of branches) findings.get(row.id).add('branch');
    // Linear-time walks of the unambiguous predecessor graph. Duplicate hash
    // edges are reported as ambiguous, never guessed or silently selected.
    const done = new Set();
    for (const start of group) {
      const path = [], positions = new Map();
      let current = start;
      while (current && !done.has(current.id)) {
        if (positions.has(current.id)) {
          for (const row of path.slice(positions.get(current.id))) findings.get(row.id).add('cycle');
          break;
        }
        positions.set(current.id,path.length); path.push(current);
        if (current.previous === null || current.previous === 'GENESIS') break;
        const parents = byHash.get(current.previous) ?? [];
        if (parents.length !== 1) {
          findings.get(current.id).add(parents.length ? 'ambiguous_reference' : 'missing_reference');
          break;
        }
        current = parents[0];
      }
      for (const row of path) done.add(row.id);
    }
  }
  if (recomputation) {
    check(recomputation.schema === 'audit-v1-recomputation:1' && hashPattern.test(recomputation.settingsEvidenceDigest)
      && typeof recomputation.timeZone === 'string' && recomputation.timeZone.length > 0
      && typeof recomputation.dateStyle === 'string' && recomputation.dateStyle.length > 0
      && Array.isArray(recomputation.rows));
    const calculated = new Map();
    for (const value of recomputation.rows) {
      check(uuidPattern.test(value.id) && hashPattern.test(value.hash) && !calculated.has(value.id));
      calculated.set(value.id,value.hash);
    }
    check(calculated.size === rows.length && rows.every(row => calculated.has(row.id)));
    for (const row of rows) if (calculated.get(row.id) !== row.hash) findings.get(row.id).add('hash_mismatch');
  } else for (const row of rows) findings.get(row.id).add('unreproducible');
  const anomalies = rows.map(row => ({ id: row.id, scope: row.scope, categories: [...findings.get(row.id)].sort() })).filter(row=>row.categories.length);
  const counts = {};
  for (const row of anomalies) for (const category of row.categories) counts[category] = String(BigInt(counts[category] ?? '0') + 1n);
  return { schema: 'audit-v1-classification:1', historicalVerdict: 'unresolved',
    ...inventorySummary(rows), counts, anomalies,
    recomputationSettingsEvidence: recomputation?.settingsEvidenceDigest ?? null };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , input, output, settings] = process.argv;
    check(input && output);
    const items = JSON.parse(readFileSync(input,'utf8')).flatMap(chunk => { check(chunk.schema === 'audit-chunk:1'); return chunk.items; });
    const report = classifyInventory(items,settings ? JSON.parse(readFileSync(settings,'utf8')) : null);
    writeFileSync(output,JSON.stringify(report),{ flag:'wx',mode:0o600 });
  } catch { process.stderr.write('audit_cutover_classification_failed\n'); process.exitCode=1; }
}

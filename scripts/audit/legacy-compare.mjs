// Offline only. Inputs must be generation-pinned private evidence, not console
// output. Never rewrites events or infers a historical pass from missing fields.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
const numberToken = Symbol('json-number');
function lossless(text) {
  return JSON.parse(text, (_key, value, context) => typeof value === 'number' ? { [numberToken]: context.source } : value);
}
const historicalColumns = ['id', 'event_id', 'organization_id', 'actor_id', 'action_type', 'resource_type', 'resource_id',
  'outcome', 'request_id', 'session_id', 'reason', 'created_at', 'details', 'ip_hash', 'user_agent',
  'previous_hash', 'event_hash', 'integrity_version'];
function utc(value) {
  if (typeof value !== 'string') return value;
  const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(value);
  return match ? `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(6, '0')}Z` : value;
}
export function compareLegacy(chunkText, legacyText) {
  const chunk = JSON.parse(chunkText);
  const old = lossless(legacyText);
  if (chunk.schema !== 'audit-chunk:1' || old.schemaVersion?.[numberToken] !== '1' || !Array.isArray(old.events)) throw new Error('unsupported_schema');
  const expected = new Map(chunk.items.filter(item => item.kind === 'v1').map(item => {
    const row = lossless(Buffer.from(item.inventory, 'base64').toString());
    if (row[0] !== 'audit-inventory:2' || row.length !== 22) throw new Error('unsupported_inventory');
    return [item.id, Object.fromEntries(historicalColumns.map((column, index) => [column, row[index + 1]]))];
  }));
  let matched = 0, missingColumns = 0, differences = 0, unknownRows = 0, duplicateRows = 0;
  const seen = new Set();
  for (const row of old.events) {
    if (seen.has(row.id)) duplicateRows++;
    seen.add(row.id);
    const current = expected.get(row.id);
    if (!current) { unknownRows++; continue; }
    let same = true;
    for (const column of historicalColumns) {
      if (!Object.hasOwn(row, column)) { missingColumns++; same = false; }
      else if (!isDeepStrictEqual(column === 'created_at' ? utc(row[column]) : row[column], current[column])) { differences++; same = false; }
    }
    if (same) matched++;
  }
  return {
    schema: 'audit-legacy-comparison:1', historicalVerdict: 'unresolved',
    matched: String(matched), missingColumns: String(missingColumns), differences: String(differences),
    unknownRows: String(unknownRows), duplicateRows: String(duplicateRows),
    absentFromThisExport: String([...expected.keys()].filter(id => !seen.has(id)).length),
    // A's columns did not exist in schemaVersion=1; absence is not a mismatch,
    // and this comparison never claims those columns were historically proved.
    unprovedColumns: ['chain_scope', 'chain_sequence', 'chain_cutover_id'],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , chunk, legacy, output] = process.argv;
  if (!chunk || !legacy || !output) throw new Error('usage: legacy-compare chunk.json legacy-export.json private-report.json');
  writeFileSync(output, JSON.stringify(compareLegacy(readFileSync(chunk, 'utf8'), readFileSync(legacy, 'utf8'))), { flag: 'wx', mode: 0o600 });
}

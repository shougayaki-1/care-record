import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLegacy } from './legacy-compare.mjs';
const id = '15000000-0000-4000-8000-000000000001';
const columns = ['id','event_id','organization_id','actor_id','action_type','resource_type','resource_id','outcome','request_id','session_id','reason','created_at','details','ip_hash','user_agent','previous_hash','event_hash','integrity_version'];
function fixture() {
  const inv = ['audit-inventory:2',id,id,null,null,'fixture','audit',null,'success',null,null,null,'2026-10-24T00:00:00.123456Z',{ unicode: '日本語\n', value: 1 },null,null,null,null,1,null,null,null];
  const chunk = { schema: 'audit-chunk:1', items: [{ kind: 'v1', id, inventory: Buffer.from(JSON.stringify(inv)).toString('base64') }] };
  const legacy = { schemaVersion: 1, events: [Object.fromEntries(columns.map((name,i) => [name,inv[i+1]]))] };
  return { chunk, legacy };
}
test('old schema comparison does not require A columns or claim a historical pass', () => {
  const { chunk, legacy } = fixture();
  legacy.events[0].created_at = '2026-10-24T00:00:00.123456+00:00';
  const report = compareLegacy(JSON.stringify(chunk),JSON.stringify(legacy));
  assert.equal(report.matched,'1'); assert.equal(report.historicalVerdict,'unresolved'); assert.equal(report.differences,'0');
  assert.equal(report.unprovedColumns.length,3);
});
test('columns missing from the original schema, missing rows, and duplicates are explicit', () => {
  const { chunk, legacy } = fixture(); delete legacy.events[0].ip_hash; legacy.events.push(legacy.events[0]);
  const report = compareLegacy(JSON.stringify(chunk),JSON.stringify(legacy));
  assert.equal(report.missingColumns,'2'); assert.equal(report.duplicateRows,'1'); assert.equal(report.matched,'0');
});
test('large JSON numbers cannot silently round to the same value', () => {
  const { chunk, legacy } = fixture();
  const original = Buffer.from(chunk.items[0].inventory,'base64').toString().replace('"value":1','"value":9007199254740993');
  chunk.items[0].inventory=Buffer.from(original).toString('base64');
  const old = JSON.stringify(legacy).replace('"value":1','"value":9007199254740992');
  assert.equal(compareLegacy(JSON.stringify(chunk),old).differences,'1');
});

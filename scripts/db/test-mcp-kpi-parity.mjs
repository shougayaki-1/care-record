// Only a dedicated disposable local stack may be used. The fixture is rolled back.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const container = process.argv[2];
if (!/^supabase_db_care-record-(?:185-validation|owner-add-test-[a-z0-9]+)$/.test(container ?? '')) {
  throw new Error('A dedicated disposable KPI validation stack is required.');
}
const fixture = readFileSync(new URL('../../supabase/tests/mcp_kpi_source.test.sql', import.meta.url), 'utf8');
const marker = 'set local role mcp_import;';
if (!fixture.startsWith('begin;') || !fixture.includes(marker) || !fixture.includes('select plan(14);')) {
  throw new Error('Synthetic KPI fixture changed; update the parity test.');
}
const setup = fixture.split(marker, 1)[0].replace('select plan(14);\n', '');
const sql = `${setup}
insert into private.mcp_kpi_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at)
values ('18500000-0000-0000-0000-000000000002',true,'{}','18500000-0000-0000-0000-000000000001',now());
set local role mcp_import;
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-000000000001","role":"mcp_import","exp":4102444800,"client_id":"18500000-0000-0000-0000-000000000003","session_id":"18500000-0000-0000-0000-000000000005"}';
select public.get_mcp_kpi_source('18500000-0000-0000-0000-000000000002','2026-07');
rollback;
`;
const query = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 30000 });
if (query.error) throw query.error;
if (query.status !== 0) throw new Error('Synthetic KPI database query failed');
const parsed = JSON.parse(query.stdout.trim());
if (!parsed || !Array.isArray(parsed.shifts) || !Array.isArray(parsed.reports) || !Array.isArray(parsed.internal_work)) throw new Error('Unexpected synthetic KPI projection');
const dir = mkdtempSync(join(tmpdir(), 'care-record-kpi-parity-'));
try {
  const file = join(dir, 'projection.json');
  writeFileSync(file, JSON.stringify(parsed), { mode: 0o600 });
  const result = spawnSync('node_modules/.bin/vitest', ['run', 'src/utils/statisticsKpiDatabase.test.ts'], {
    env: { ...process.env, MCP_KPI_SYNTHETIC_PROJECTION: file }, stdio: 'inherit', timeout: 60000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Synthetic KPI parity test failed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

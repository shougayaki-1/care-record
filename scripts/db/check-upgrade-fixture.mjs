import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [container, stage] = process.argv.slice(2);
if (!/^supabase_db_care-record-(?:upgrade|owner-add)-test-[a-z0-9]+$/.test(container ?? '')
    || !['before', 'after'].includes(stage)) {
  throw new Error('Pass a dedicated disposable upgrade-test container and before/after stage.');
}
const sql = readFileSync(new URL(`./upgrade-fixture-${stage}.sql`, import.meta.url), 'utf8');
const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 30_000 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'Upgrade fixture failed');
console.log(`PASS: upgrade fixture ${stage}`);

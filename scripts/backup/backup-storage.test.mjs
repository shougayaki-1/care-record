import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-storage-test-'));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_ROOT: dir };
  function executable(name, code) {
    writeFileSync(join(dir, name), `#!${process.execPath}\n${code}`, { mode: 0o755 });
  }
  try { return run({ dir, env, executable }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const storageMock = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.MOCK_ROOT, 'calls'), JSON.stringify(args) + '\\n');
if (process.env.MOCK_DENY === 'true') process.exit(1);
if (args[1] === 'ls') {
  if (process.env.MOCK_LIST_ERROR) {
    process.stderr.write(process.env.MOCK_LIST_ERROR);
    process.exit(1);
  }
  process.stdout.write(process.env.MOCK_LISTING || '');
  process.exit(0);
}
const [src, dest] = args.slice(-2);
const local = uri => uri.startsWith('gs://') ? path.join(process.env.MOCK_ROOT, encodeURIComponent(uri)) : uri;
const source = local(src), target = local(dest);
if (args.includes('--if-generation-match=0') && fs.existsSync(target)) process.exit(1);
if (dest.endsWith('.sha256') && process.env.MOCK_FAIL_CHECKSUM === 'true') process.exit(1);
if (!fs.existsSync(source)) process.exit(1);
fs.copyFileSync(source, target);
`;

test('publication recovers a missing checksum and preserves the first representative on retry', () => fixture(({ dir, env, executable }) => {
  executable('gcloud', storageMock);
  const archive = join(dir, 'dump.tar.gz');
  const uri = 'gs://fixture-daily/full/production/daily/2026/11/01/care-record-production-2026-11-01.tar.gz';
  const body = join(dir, encodeURIComponent(uri));
  const checksum = join(dir, encodeURIComponent(`${uri}.sha256`));
  writeFileSync(archive, 'first dump');
  const publish = extra => spawnSync('bash', ['scripts/backup/publish-backup-pair.sh', archive, uri], { env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(publish({ MOCK_FAIL_CHECKSUM: 'true' }).status, 1);
  assert.equal(readFileSync(body, 'utf8'), 'first dump');
  assert.equal(existsSync(checksum), false);
  writeFileSync(archive, 'second dump');
  const hash = createHash('sha256').update('first dump').digest('hex');
  const recovered = publish();
  assert.equal(recovered.status, 0);
  assert.equal(recovered.stdout, `${hash}\n`);
  assert.equal(readFileSync(checksum, 'utf8'), `${hash}  care-record-production-2026-11-01.tar.gz\n`);
  assert.equal(publish().status, 0);
  assert.equal(readFileSync(body, 'utf8'), 'first dump');
  writeFileSync(checksum, 'corrupt checksum');
  assert.equal(publish().status, 1);
  assert.equal(readFileSync(checksum, 'utf8'), 'corrupt checksum');
}));

test('publication does not mistake an upload/read permission failure for an existing success', () => fixture(({ dir, env, executable }) => {
  executable('gcloud', storageMock);
  const archive = join(dir, 'dump.tar.gz');
  writeFileSync(archive, 'dump');
  const result = spawnSync('bash', ['scripts/backup/publish-backup-pair.sh', archive, 'gs://fixture-recent/backup.tar.gz'], { env: { ...env, MOCK_DENY: 'true' } });
  assert.equal(result.status, 1);
}));

test('full dump publishes the selected tiers and emits a portable recent receipt', () => fixture(({ dir, env, executable }) => {
  executable('gcloud', storageMock);
  for (const name of ['pg_dump', 'pg_dumpall']) executable(name, 'console.log("-- synthetic database dump");');
  executable('psql', `
const args = process.argv.join(' ');
require('node:fs').appendFileSync(process.env.MOCK_ROOT + '/db-calls', 'read\\n');
console.log(args.includes('SHOW server_version') ? '17.6' : args.includes('count(*)') ? '0' : 'fixture_header');
`);
  const output = join(dir, 'outputs');
  const config = {
    ...env, DATABASE_URL: 'postgresql://fixture.invalid', APP_ENV: 'staging',
    GCS_BACKUP_BUCKET: 'fixture-legacy', BACKUP_CONFIG_VERSION: 'fixture', BACKUP_KEY_ID: 'fixture-id',
    GCS_TIERED_BACKUP_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule', BACKUP_RETENTION_AT: '2026-11-01T00:17:00Z',
    GCS_RECENT_BACKUP_BUCKET: 'fixture-recent', GCS_DAILY_BACKUP_BUCKET: 'fixture-daily',
    GCS_WEEKLY_BACKUP_BUCKET: 'fixture-weekly', GCS_MONTHLY_BACKUP_BUCKET: 'fixture-monthly', GITHUB_OUTPUT: output,
  };
  const result = spawnSync('bash', ['scripts/backup/full-logical-backup.sh'], { env: config, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.filter(args => !args.at(-1).endsWith('.sha256')).map(args => args.at(-1).split('/')[5]), ['recent', 'daily', 'weekly', 'monthly']);
  const receipt = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
  const body = readFileSync(join(dir, encodeURIComponent(receipt.backup_uri)));
  assert.equal(receipt.backup_sha256, createHash('sha256').update(body).digest('hex'));
  assert.match(receipt.backup_uri, /fixture-recent\/full\/staging\/recent\//);
  rmSync(join(dir, 'db-calls'));
  const partial = spawnSync('bash', ['scripts/backup/full-logical-backup.sh'], { env: { ...config, GCS_MONTHLY_BACKUP_BUCKET: '' }, encoding: 'utf8' });
  assert.equal(partial.status, 2);
  assert.equal(existsSync(join(dir, 'db-calls')), false);
}));

test('restore rejects a mismatched external checksum before extraction or DB writes', () => fixture(({ dir, env, executable }) => {
  executable('gcloud', storageMock);
  executable('psql', `require('node:fs').writeFileSync(process.env.MOCK_ROOT + '/db-writes', 'unexpected');`);
  const uri = 'gs://fixture-monthly/full/production/monthly/2026/11/01/backup.tar.gz';
  writeFileSync(join(dir, encodeURIComponent(uri)), 'synthetic corrupted archive');
  writeFileSync(join(dir, encodeURIComponent(`${uri}.sha256`)), `${'0'.repeat(64)}  backup.tar.gz\n`);
  const result = spawnSync('bash', ['scripts/backup/restore-logical-backup.sh', uri], {
    env: { ...env, RESTORE_DATABASE_URL: 'postgresql://fixture.invalid', RESTORE_ENVIRONMENT: 'staging', RESTORE_CONFIRM: 'restore-to-isolated-environment', EMAIL_DELIVERY_ENABLED: 'false', GOOGLE_SYNC_ENABLED: 'false', AI_IMPORT_ENABLED: 'false' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Archive checksum mismatch/);
  assert.equal(existsSync(join(dir, 'db-writes')), false);
}));

function freshnessFixture(run) {
  return fixture(({ dir, env, executable }) => {
    executable('gcloud', storageMock);
    // GNU date is used on the Linux runner. Keep the test portable on macOS.
    executable('date', `
const arg = process.argv.find(arg => arg.startsWith('--date='));
console.log(arg ? Date.parse(arg.slice(7)) / 1000 : process.env.MOCK_NOW);
`);
    const base = { ...env, APP_ENV: 'production', GCS_BACKUP_BUCKET: 'fixture-legacy', GCS_REPLICA_BUCKET: 'fixture-replica', GCS_TIERED_BACKUP_ENABLED: 'true', GCS_RECENT_BACKUP_BUCKET: 'fixture-recent', GCS_RECENT_REPLICA_BUCKET: 'fixture-recent-osaka', DISCORD_ALERT_WEBHOOK_URL: '', EVIDENCE_URL: 'https://github.com/fixture/repo/actions/runs/42' };
    const uri = 'gs://fixture-recent/full/production/recent/2026/10/07/care-record-production-20261007T001700Z.tar.gz';
    const listing = `123 2026-10-07T23:59:00Z ${uri}\n65 2026-10-07T23:59:01Z ${uri}.sha256\n`;
    const check = (hours, extra = {}) => spawnSync('bash', ['scripts/backup/check-backup-freshness.sh'], {
      env: { ...base, MOCK_NOW: String(Date.parse('2026-10-07T00:17:00Z') / 1000 + hours * 3600), MOCK_LISTING: listing, ...extra }, encoding: 'utf8',
    });
    return run({ dir, check, listing, uri });
  });
}

function executableNotificationMocks(dir) {
  writeFileSync(join(dir, 'jq'), `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.MOCK_ROOT + '/notification-jq-args', JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('fixture-payload');\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.MOCK_ROOT + '/notification-curl-args', JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o755 });
}

test('freshness requires a pair and uses dump start rather than copy time, at the 14h boundary', () => freshnessFixture(({ dir, check, uri }) => {
  assert.equal(check(14).status, 0);
  assert.equal(check(14 + 1 / 3600).status, 1);
  assert.equal(check(1, { MOCK_LISTING: `123 2026-10-07T23:59:00Z ${uri}\n` }).status, 1);
  assert.equal(check(1, { MOCK_DENY: 'true' }).status, 1);
  const calls = readFileSync(join(dir, 'calls'), 'utf8');
  assert.match(calls, /gs:\/\/fixture-recent\/full\/production\/recent\/\*\*/);
  assert.match(calls, /gs:\/\/fixture-recent-osaka\/full\/production\/recent\/\*\*/);
  assert.doesNotMatch(calls, /fixture-legacy/);
}));

test('legacy complete generations remain compatible; incomplete newest generation is ignored', () => freshnessFixture(({ check, listing, uri }) => {
  assert.equal(check(1, { GCS_TIERED_BACKUP_ENABLED: 'false', MOCK_LISTING: listing.replaceAll('/recent/', '/').replaceAll('fixture-recent', 'fixture-legacy') }).status, 0);
  const unpaired = uri.replace('20261007T001700Z', '20261007T121700Z');
  assert.equal(check(15, { MOCK_LISTING: `${listing}123 2026-10-07T23:59:00Z ${unpaired}\n` }).status, 1);
}));

test('replica freshness has a distinct 26h boundary', () => freshnessFixture(({ dir, check, listing }) => {
  writeFileSync(join(dir, 'gcloud'), `#!${process.execPath}\n
const args = process.argv.slice(2);
const fresh = ${JSON.stringify(listing.replaceAll('20261007T001700Z', '20261008T001700Z'))};
const stale = ${JSON.stringify(listing)};
console.log(args.at(-1).includes('osaka') ? stale : fresh);
`, { mode: 0o755 });
  assert.equal(check(26).status, 0);
  assert.equal(check(26 + 1 / 3600).status, 1);
}));

test('freshness reports permission failures and missing complete pairs with safe cause categories', () => freshnessFixture(({ check, uri }) => {
  const denied = check(1, { MOCK_LIST_ERROR: 'ERROR 403: storage.objects.list permission denied' });
  assert.equal(denied.status, 1);
  assert.match(denied.stdout, /target=tokyo cause=listing_permission_denied latest_generation_utc=none age_seconds=unknown threshold_seconds=50400/);
  assert.match(denied.stdout, /target=osaka cause=listing_permission_denied latest_generation_utc=none age_seconds=unknown threshold_seconds=93600/);
  assert.doesNotMatch(denied.stdout + denied.stderr, /storage\.objects\.list permission denied/i);

  const listingFailed = check(1, { MOCK_LIST_ERROR: 'temporary network failure' });
  assert.equal(listingFailed.status, 1);
  assert.match(listingFailed.stdout, /cause=listing_failed latest_generation_utc=none age_seconds=unknown/);

  const missingPair = check(1, { MOCK_LISTING: `123 2026-10-07T23:59:00Z ${uri}\n` });
  assert.equal(missingPair.status, 1);
  assert.match(missingPair.stdout, /cause=no_valid_pair latest_generation_utc=none age_seconds=unknown/);
}));

test('stale generation logs include its timestamp, computed age, threshold, and alert diagnostics', () => freshnessFixture(({ dir, check, listing }) => {
  executableNotificationMocks(dir);
  writeFileSync(join(dir, 'gcloud'), `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst listing = ${JSON.stringify(listing)};\nconst fresh = listing.replaceAll('20261007T001700Z', '20261008T001700Z');\nprocess.stdout.write(args.at(-1).includes('osaka') ? listing : fresh);\n`, { mode: 0o755 });
  const stale = check(27, { MOCK_LISTING: listing, DISCORD_ALERT_WEBHOOK_URL: 'https://discord.invalid/webhook' });
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /environment=production target=tokyo cause=within_threshold latest_generation_utc=2026-10-08T00:17:00Z age_seconds=10800 threshold_seconds=50400/);
  assert.match(stale.stdout, /environment=production target=osaka cause=age_over_threshold latest_generation_utc=2026-10-07T00:17:00Z age_seconds=97200 threshold_seconds=93600/);

  const notificationArgs = readFileSync(join(dir, 'notification-jq-args'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(notificationArgs.length, 1);
  assert.ok(notificationArgs[0].includes('replica_freshness_over_26h_age_over_threshold'));
  assert.ok(notificationArgs[0].includes('cause=age_over_threshold latest_generation_utc=2026-10-07T00:17:00Z age_seconds=97200 threshold_seconds=93600'));
  assert.ok(notificationArgs[0].includes('https://github.com/fixture/repo/actions/runs/42'));
  assert.equal(readFileSync(join(dir, 'notification-curl-args'), 'utf8').trim().split('\n').length, 1);
}));

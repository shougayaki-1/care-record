import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Calendar representatives use the business timezone. Both scheduled runs may
// propose the same key: publishing is create-only, so the first success wins.
export function retentionPlan({ environment, at, generation, scheduled, buckets }) {
  if (!['production', 'staging'].includes(environment)) throw new Error('Invalid backup environment');
  if (!/^\d{8}T\d{6}Z$/.test(generation)) throw new Error('Invalid backup generation');
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid retention timestamp');
  for (const tier of ['recent', 'daily', 'weekly', 'monthly']) {
    const bucket = buckets[tier];
    if (!bucket || !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) || /replace-|example/.test(bucket)) {
      throw new Error(`Invalid or missing ${tier} backup bucket`);
    }
  }
  if (new Set(Object.values(buckets)).size !== 4) throw new Error('Backup tier buckets must be distinct');
  const calendar = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
  const date = calendar.toISOString().slice(0, 10);
  const tiers = ['recent'];
  if (scheduled) {
    tiers.push('daily');
    if (calendar.getUTCDay() === 0) tiers.push('weekly');
    if (calendar.getUTCDate() === 1) tiers.push('monthly');
  }
  return tiers.map(tier => {
    const bucket = buckets[tier];
    const key = tier === 'recent' ? generation : date;
    return { tier, uri: `gs://${bucket}/full/${environment}/${tier}/${date.replaceAll('-', '/')}/care-record-${environment}-${key}.tar.gz` };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = process.env;
  try {
    const plan = retentionPlan({
      environment: env.APP_ENV, at: env.BACKUP_RETENTION_AT,
      generation: env.BACKUP_GENERATION, scheduled: env.GITHUB_EVENT_NAME === 'schedule',
      buckets: Object.fromEntries(['recent', 'daily', 'weekly', 'monthly'].map(tier => [tier, env[`GCS_${tier.toUpperCase()}_BACKUP_BUCKET`]])),
    });
    process.stdout.write(plan.map(({ tier, uri }) => `${tier}\t${uri}`).join('\n') + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

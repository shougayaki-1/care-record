import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workflow=readFileSync(new URL('../../.github/workflows/audit-verification-manual.yml',import.meta.url),'utf8');
const match=workflow.match(/- name: Require explicit enablement[\s\S]*?\n        run: \|\n([\s\S]*?)\n      - uses:/);
if (!match) throw new Error('manual guard missing');
const guard=match[1].split('\n').map(line => line.replace(/^ {10}/,'')).join('\n');
const run=(changes={}) => spawnSync('bash',['-c',guard],{encoding:'utf8',env:{PATH:process.env.PATH,
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',INPUT_ENVIRONMENT:'staging',ENABLED:'true',PRODUCTION_APPROVED:'',...changes}});
test('manual workflow has no scheduled trigger and serializes each environment', () => {
  assert.match(workflow,/workflow_dispatch:/); assert.doesNotMatch(workflow,/^\s*schedule:/m);
  assert.match(workflow,/default: staging/); assert.match(workflow,/name: Audit verification \(\$\{\{ inputs\.environment \}\}\)/); assert.match(workflow,/group: audit-verification-\$\{\{ inputs\.environment \}\}/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.ok(workflow.indexOf('Require explicit enablement')<workflow.indexOf('google-github-actions/auth@'));
  assert.match(workflow,/failure\(\) && steps\.guard\.outcome == 'success' && steps\.verifier\.outcome == 'skipped'/);
  assert.match(workflow,/run: node scripts\/audit\/notify-preflight\.mjs/);
});
test('guard fails closed unless manual main execution is explicitly enabled', () => {
  assert.equal(run().status,0);
  for (const change of [{ENABLED:''},{GITHUB_EVENT_NAME:'schedule'},{GITHUB_REF:'refs/heads/other'},
    {INPUT_ENVIRONMENT:'invalid'},{INPUT_ENVIRONMENT:'production',PRODUCTION_APPROVED:''}]) assert.equal(run(change).status,1);
  assert.equal(run({INPUT_ENVIRONMENT:'production',PRODUCTION_APPROVED:'true'}).status,0);
});

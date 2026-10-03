import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchName, metadata, selectIssue, disposition } from './lib/queue.mjs';
import { emptyState, loadState, saveJson, lockState } from './lib/state.mjs';
import { codexArgs, redact, quotaKind, quotaResetAt, nextQuotaRetry, runCodex, validateResult } from './lib/codex-runner.mjs';
import { command, safeEnvironment } from './lib/process.mjs';
import { configuration, worker } from './continuous-worker.mjs';
import { GitHub } from './lib/github.mjs';

const issue = (number, names = ['codex:ready'], body = '') => ({ number, title: `Task ${number}`, state: 'open', labels: names.map(name => ({ name })), body, html_url: `https://github.com/test/repo/issues/${number}` });
const result = { status: 'completed', summary: 'Implemented', tests: ['typecheck', 'lint'], unrun_tests: 'E2E: human confirmation required', security_impact: 'None', remaining_work: 'None', safe_to_open_pr: true };
const config = configuration({});

test('priority labels, metadata, issue order and default priority', () => {
  const issues = [issue(1), issue(8, ['codex:ready', 'priority:p1']), issue(9, ['codex:ready', 'priority:p0']), issue(7, ['codex:ready', 'priority:p1'])];
  assert.equal(selectIssue(issues, new Map()).number, 9);
  assert.equal(selectIssue(issues.filter(i => i.number !== 9), new Map()).number, 7);
  assert.equal(selectIssue([issue(1), issue(2, ['codex:ready'], '<!-- codex-queue\npriority: p2\ndepends_on: []\n-->')], new Map()).number, 2);
});

test('open or unknown dependency blocks; closed dependency allows selection', () => {
  const item = issue(40, ['codex:ready'], '<!-- codex-queue\npriority: p1\ndepends_on: [39]\n-->');
  for (const state of ['open', undefined]) assert.equal(selectIssue([item], new Map([[39, state]])), null);
  assert.equal(selectIssue([item], new Map([[39, 'closed']])).number, 40);
  assert.deepEqual(metadata(item.body), { dependencies: [39], priority: 'p1' });
});

test('invalid dependency metadata fails closed', () => {
  for (const value of ['["39"]', '39', '[0]', '[1,]']) assert.equal(selectIssue([issue(1, ['codex:ready'], `<!-- codex-queue\ndepends_on: ${value}\n-->`)], new Map()), null);
});

test('blocked, running, failed, needs-human, closed and linked PR issues are excluded', () => {
  for (const label of ['codex:blocked', 'codex:running', 'codex:failed', 'codex:needs-human']) assert.equal(selectIssue([issue(1, ['codex:ready', label])], new Map()), null);
  assert.equal(selectIssue([{ ...issue(1), state: 'closed' }], new Map()), null);
  assert.equal(selectIssue([issue(1)], new Map(), new Set([1])), null);
});

test('branch slug remains valid for Japanese and hostile titles', () => {
  assert.equal(branchName({ number: 56, title: '日本語' }), 'codex/issue-56-implementation');
  assert.equal(branchName({ number: 56, title: '../Fix `x` / BUG' }), 'codex/issue-56-fix-x-bug');
});

test('quota reset and retry-after take precedence over conservative exponential backoff', () => {
  const now = 1_800_000_000_000;
  assert.equal(quotaResetAt({ error: { reset_at: (now + 30_000) / 1000 } }, now), now + 30_000);
  assert.equal(quotaResetAt({ headers: { 'Retry-After': 60 } }, now), now + 60_000);
  assert.equal(quotaResetAt({ resets_at: new Date(now + 90_000).toISOString() }, now), now + 90_000);
  assert.equal(quotaResetAt('retry-after: 120', now), now + 120_000);
  assert.equal(quotaResetAt({ reset_at: (now - 1000) / 1000 }, now), null);
  assert.equal(nextQuotaRetry({ resetAt: now + 30_000 }, 20, config, now), now + 30_000);
  assert.equal(nextQuotaRetry({}, 0, config, now), now + config.quotaBackoffMs);
  assert.equal(nextQuotaRetry({}, 1, config, now), now + config.quotaBackoffMs * 2);
  assert.equal(nextQuotaRetry({ quota: 'weekly' }, 0, config, now), now + config.weeklyBackoffMs);
  assert.equal(nextQuotaRetry({}, 100, config, now), now + config.quotaMaxBackoffMs);
  const localNow = new Date(2026, 9, 3, 12, 0).getTime();
  assert.equal(quotaResetAt({ error: { message: 'Usage limit. Try again at 3:20 PM.' } }, localNow), new Date(2026, 9, 3, 15, 20).getTime());
  assert.equal(quotaResetAt('Try again at Oct 4th, 2026 3:20 PM.', localNow), new Date(2026, 9, 4, 15, 20).getTime());
});

test('quota, weekly quota, interruptions, failures and bounded retry are distinct', () => {
  assert.equal(disposition({ quota: 'window' }, 99, config), 'quota_wait');
  assert.equal(disposition({ quota: 'window' }, 0, config, 2), 'quota_wait');
  assert.equal(disposition({ quota: 'weekly' }, 0, config), 'quota_wait');
  assert.equal(disposition({ result: { status: 'quota_wait' } }, 0, config), 'quota_wait');
  assert.equal(disposition({ interrupted: true }, 0, config), 'paused');
  assert.equal(disposition({ code: 1 }, 0, config), 'retry');
  assert.equal(disposition({ code: 1 }, 1, config), 'failed');
  assert.equal(disposition({ result: { status: 'needs_human' } }, 0, config), 'needs_human');
  assert.equal(disposition({ needsHuman: true, code: 1 }, 0, config), 'needs_human');
  assert.equal(disposition({ code: 1, result }, 1, config), 'failed');
});

test('quota detection handles codes, variants and weekly limits', () => {
  for (const text of ['usage_limit_reached', 'Rate limit exceeded', 'insufficient_quota', '利用上限に達しました', 'HTTP 429', 'Your workspace is out of credits']) assert.equal(quotaKind({ error: { message: text } }), 'window');
  assert.equal(quotaKind('Weekly usage limit reached'), 'weekly');
  assert.equal(quotaKind('invalid credential'), null);
});

test('credentials are redacted and not inherited by Codex', () => {
  assert.equal(redact('token=my-private-token sk-example123 ghp_example123', { MY_SECRET: 'my-private-token' }).includes('my-private-token'), false);
  assert.equal(redact('https://user:password@host/path'), 'https://[REDACTED]@host/path');
  const env = safeEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'secret', GH_TOKEN: 'secret' }, { home: '/credential-free-home' });
  for (const name of ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GH_TOKEN']) assert.equal(env[name], undefined);
  assert.equal(env.HOME, '/credential-free-home');
  const args = codexArgs({ session: 'session-id' }, '/schema');
  assert.ok(args.includes('resume'));
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(validateResult({ ...result, tests: [1] }), null);
});

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'care-worker-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return realpath(path);
}

test('atomic state persistence, restart restoration, corrupt state and exclusive lock', async t => {
  const path = await directory(t);
  const state = { ...emptyState(), status: 'quota-wait', nextRetryAt: 123, current: { number: 40, branch: 'codex/issue-40-task', worktree: '/worktree', failures: 0, quotaWaits: 0, stage: 'implement', session: 'abc' } };
  await saveJson(join(path, 'state.json'), state);
  assert.deepEqual(await loadState(path), state);
  const unlock = await lockState(path);
  await assert.rejects(lockState(path), /lock exists/);
  await unlock();
  await writeFile(join(path, 'state.json'), '{broken');
  await assert.rejects(loadState(path), /unreadable/);
});

function mockExecute(items, calls) {
  return async (binary, args, options) => {
    calls.push([binary, args, options]);
    if (binary === 'git') {
      if (args[0] === 'remote') return 'https://github.com/test/repo.git';
      if (args[0] === 'rev-parse') return args.includes('--git-common-dir') ? '/git-meta' : 'base-sha';
      if (args[0] === 'branch') { const n = options?.cwd?.match(/issue-(\d+)$/)?.[1] ?? '40'; return `codex/issue-${n}-task-${n}`; }
      if (args[0] === 'rev-list') return '1';
      if (args[0] === 'diff') return 'A\tscripts/example.mjs';
      return '';
    }
    if (binary === 'npm') return '';
    if (binary === 'codex') return '--json --output-schema';
    if (args[0] === 'api') {
      const endpoint = args.at(-1);
      const number = endpoint.match(/\/issues\/(\d+)$/)?.[1];
      if (number) return JSON.stringify(items.find(i => i.number === Number(number)) ?? issue(Number(number)));
      if (endpoint.includes('/timeline?')) return '[[]]';
      if (endpoint.includes('/pulls?')) return '[[]]';
      return JSON.stringify([items]);
    }
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'pr' && args[1] === 'create') return 'https://github.com/test/repo/pull/99';
    return '';
  };
}

test('dry-run is read-only: no fetch, lock, state write, Codex run or GitHub mutation', async t => {
  const path = await directory(t);
  const calls = [];
  const stateDir = join(path, 'state');
  await assert.rejects(worker({ config: { ...config, stateDir }, root: path, mode: 'dry-run', execute: mockExecute([issue(40)], calls), report: () => {} }), /outside/);
  const root = join(path, 'root'); await mkdir(root);
  await worker({ config: { ...config, stateDir }, root, mode: 'dry-run', execute: mockExecute([issue(40)], calls), report: () => {}, run: () => assert.fail('Codex executed') });
  assert.ok(calls.every(([binary, args]) => binary === 'git' ? args[0] === 'remote' : binary === 'gh' && args[0] === 'api'));
  await assert.rejects(readFile(join(stateDir, 'state.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(stateDir, 'worker.lock')), { code: 'ENOENT' });
});

test('quota wait survives restart and resumes same Issue before queue selection', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const stateDir = join(path, 'state'); await mkdir(stateDir);
  const calls = [];
  let time = 1000;
  const options = { config: { ...config, stateDir }, root, mode: 'once', now: () => time, execute: mockExecute([issue(40)], calls), report: () => {} };
  const first = await worker({ ...options, run: async ({ onSession }) => { await onSession('session-id'); return { quota: 'window', code: 1 }; } });
  assert.equal(first.lastReason, 'quota_wait');
  assert.equal(first.current.number, 40);
  assert.equal(first.current.session, 'session-id');
  assert.equal(first.current.failures, 0);
  assert.equal(first.status, 'quota-wait');
  let resumed = false;
  calls.length = 0;
  await worker({ ...options, run: () => assert.fail('Resumed before reset') });
  assert.ok(calls.every(([binary, args]) => !(binary === 'gh' && args[0] === 'api')));
  time = first.nextRetryAt;
  const second = await worker({ ...options, run: async ({ current }) => {
    resumed = true;
    assert.equal(current.number, 40);
    assert.equal(current.session, 'session-id');
    return { code: 0, result };
  } });
  assert.ok(resumed);
  assert.equal(second.current, null);
  assert.equal(second.lastReason, 'completed');
  assert.ok(calls.some(([binary, args]) => binary === 'git' && args[0] === 'push'));
  assert.ok(calls.some(([binary, args]) => binary === 'gh' && args[1] === 'create' && args.includes('--draft')));
  assert.ok(!calls.some(([, args]) => args.includes('merge')));
  assert.ok(!calls.some(([binary, args]) => binary === 'git' && args[0] === 'fetch'));
});

test('status is read-only and requires neither GitHub nor Codex', async t => {
  const path = await directory(t);
  const state = { ...emptyState(), status: 'quota-wait', nextRetryAt: 1234 };
  await saveJson(join(path, 'state.json'), state);
  let output;
  await worker({ config: { ...config, stateDir: path }, mode: 'status', report: text => { output = JSON.parse(text); }, execute: () => assert.fail('External command ran') });
  assert.equal(output.status, 'quota-wait');
  assert.equal(output.nextRetryAt, 1234);
});

test('JSONL runner persists session and safe projection while extracting structured quota reset', async t => {
  const path = await directory(t);
  const binary = join(path, 'fake-codex.mjs');
  await writeFile(binary, `#!/usr/bin/env node\nprocess.stdin.resume();\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'session-123'}));\nconsole.log(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'cat .env',aggregated_output:'PHI secret ghp_secret'}}));\nconsole.log(JSON.stringify({type:'turn.failed',error:{code:'usage_limit_reached',reset_at:1800000060,message:'private patient'}}));\nconsole.error('secret=value');\n`, { mode: 0o700 });
  let session;
  const outcome = await runCodex({ current: { number: 40, branch: 'codex/issue-40-task', worktree: path }, issue: issue(40), schemaPath: '/schema', tracePath: join(path, 'trace'), stderrPath: join(path, 'stderr'), now: () => 1_800_000_000_000, binary, onSession: async id => { session = id; } });
  assert.equal(session, 'session-123');
  assert.equal(outcome.quota, 'window');
  assert.equal(outcome.resetAt, 1_800_000_060_000);
  const log = await readFile(join(path, 'trace'), 'utf8') + await readFile(join(path, 'stderr'), 'utf8');
  for (const secret of ['PHI', 'ghp_secret', 'private patient', 'secret=value', 'cat .env']) assert.ok(!log.includes(secret));
});

test('continuous worker remains active after 180 minutes and waits only on quota', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const stateDir = join(path, 'state');
  const calls = [];
  const controller = new AbortController();
  let time = 0;
  let turns = 0;
  const items = [issue(40), issue(41)];
  const execute = mockExecute(items, calls);
  const state = await worker({ config: { ...config, stateDir }, root, execute: async (binary, args, options) => {
    if (binary === 'gh' && args[0] === 'issue' && args.includes('--remove-label') && !args.includes('--add-label')) items.shift();
    return execute(binary, args, options);
  }, signal: controller.signal, now: () => time, report: () => {},
    run: async ({ current }) => { turns++; assert.equal(current.number, turns === 1 ? 40 : 41); time += 200 * 60_000; return turns === 1 ? { code: 0, result } : { code: 1, quota: 'window' }; },
    wait: async () => controller.abort(),
  });
  assert.equal(turns, 2);
  assert.equal(state.status, 'quota-wait');
  assert.equal(state.current.number, 41);
});

test('finite implementation retries end in failed and never publish', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const calls = [];
  let turns = 0;
  const state = await worker({ config: { ...config, stateDir: join(path, 'state') }, root, mode: 'once', execute: mockExecute([issue(40)], calls), report: () => {}, wait: async () => {}, run: async () => { turns++; return { code: 1 }; } });
  assert.equal(turns, 2);
  assert.equal(state.status, 'failed');
  assert.equal(state.current, null);
  assert.ok(calls.some(([binary, args]) => binary === 'gh' && args.includes('codex:failed')));
  assert.ok(!calls.some(([binary, args]) => binary === 'git' && args[0] === 'push'));
});

test('needs-human pauses immediately without publishing or consuming retries', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const calls = [];
  const state = await worker({ config: { ...config, stateDir: join(path, 'state') }, root, mode: 'once', execute: mockExecute([issue(40)], calls), report: () => {}, run: async () => ({ code: 0, result: { ...result, status: 'needs_human', safe_to_open_pr: false } }) });
  assert.equal(state.status, 'needs-human');
  assert.equal(state.paused, true);
  assert.equal(state.current.failures, 0);
  assert.ok(calls.some(([binary, args]) => binary === 'gh' && args.includes('codex:needs-human')));
  assert.ok(!calls.some(([binary, args]) => binary === 'git' && args[0] === 'push'));
});

test('verification failures preserve publish stage for recovery and do not push', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const stateDir = join(path, 'state');
  const calls = [];
  const execute = mockExecute([issue(40)], calls);
  const state = await worker({ config: { ...config, stateDir }, root, mode: 'once', report: () => {}, execute: async (binary, args, options) => {
    if (binary === 'npm' && args.includes('typecheck')) throw new Error('typecheck failed');
    return execute(binary, args, options);
  }, run: async () => ({ code: 0, result }) });
  assert.equal(state.current.stage, 'publish');
  assert.equal(state.status, 'needs-human');
  assert.ok(!calls.some(([binary, args]) => binary === 'git' && args[0] === 'push'));
  const restored = await worker({ config: { ...config, stateDir }, root, mode: 'once', resume: true, execute, report: () => {}, run: () => assert.fail('Codex reran while publishing') });
  assert.equal(restored.lastReason, 'completed');
});

test('resume falls back to the same worktree when CLI cannot resume with schema', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const stateDir = join(path, 'state');
  const calls = [];
  const execute = mockExecute([issue(40)], calls);
  await worker({ config: { ...config, stateDir }, root, mode: 'once', execute, report: () => {}, now: () => 0, run: async ({ onSession }) => { await onSession('old-session'); return { quota: 'window', code: 1, resetAt: 1000 }; } });
  let resumed = false;
  await worker({ config: { ...config, stateDir }, root, mode: 'once', now: () => 1000, execute: async (binary, args, options) => {
    if (binary === 'codex' && args.includes('resume')) return '--json';
    return execute(binary, args, options);
  }, report: () => {}, run: async ({ current }) => { resumed = true; assert.equal(current.session, null); assert.equal(current.number, 40); return { code: 0, result }; } });
  assert.ok(resumed);
});

test('GitHub snapshot excludes open PR timeline references and branch associations', async () => {
  const github = new GitHub('test/repo', async (_binary, args) => {
    assert.ok(args.includes('--paginate'));
    const endpoint = args.at(-1);
    if (endpoint.includes('/issues?')) return JSON.stringify([[issue(1)], [issue(2)]]);
    if (endpoint.includes('/pulls?')) return JSON.stringify([[{ head: { ref: 'codex/issue-1-task' } }]]);
    if (endpoint.includes('/issues/2/timeline')) return JSON.stringify([[{ source: { issue: { state: 'open', pull_request: {} } } }]]);
    return '[[]]';
  });
  const snapshot = await github.snapshot();
  assert.deepEqual([...snapshot.linked].sort(), [1, 2]);
  assert.equal(selectIssue(snapshot.issues, snapshot.dependencies, snapshot.linked), null);
});

test('publication recovery reuses a Draft PR and rejects non-draft or closed PR', async () => {
  for (const [state, isDraft, allowed] of [['OPEN', true, true], ['OPEN', false, false], ['CLOSED', true, false], ['MERGED', true, false]]) {
    const github = new GitHub('test/repo', async (_binary, args) => {
      assert.equal(args[1], 'list');
      return JSON.stringify([{ state, isDraft, url: 'https://github.com/test/repo/pull/1' }]);
    });
    if (allowed) assert.equal(await github.draft({ number: 40, branch: 'codex/issue-40-task' }, result), 'https://github.com/test/repo/pull/1');
    else await assert.rejects(github.draft({ number: 40, branch: 'codex/issue-40-task' }, result), /human review/);
  }
});

test('Codex interruption preserves resumable state and captures no raw stderr', async t => {
  const path = await directory(t);
  const binary = join(path, 'fake-interrupt.mjs');
  await writeFile(binary, `#!/usr/bin/env node\nprocess.stdin.resume();\nconsole.log(JSON.stringify({type:'thread.started',thread_id:'interrupted-session'}));\nsetInterval(()=>{},1000);\n`, { mode: 0o700 });
  const outcome = await runCodex({ current: { number: 40, branch: 'codex/issue-40-task', worktree: path }, issue: issue(40), schemaPath: '/schema', tracePath: join(path, 'trace'), stderrPath: join(path, 'stderr'), binary, maxRunMs: 200, onSession: async () => {} });
  assert.equal(outcome.interrupted, true);
  assert.equal(disposition(outcome, 0, config), 'paused');
});

test('parent worker verifies and commits actual isolated worktree changes before publishing', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const git = args => command('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Worker Test']);
  await git(['config', 'user.email', 'worker-test@example.invalid']);
  await writeFile(join(root, 'example.txt'), 'baseline\n');
  await git(['add', 'example.txt']);
  await git(['commit', '-m', 'baseline']);
  await git(['remote', 'add', 'origin', 'https://github.com/test/repo.git']);
  await git(['update-ref', 'refs/remotes/origin/main', await git(['rev-parse', 'HEAD'])]);
  const calls = [];
  const mock = mockExecute([issue(40)], calls);
  let pushed = false;
  const state = await worker({ config: { ...config, stateDir: join(path, 'state') }, root, mode: 'once', report: () => {}, execute: async (binary, args, options) => {
    if (binary === 'git') {
      if (args[0] === 'fetch') return '';
      if (args[0] === 'push') {
        assert.equal(await command('git', ['status', '--porcelain'], options), '');
        assert.equal(await command('git', ['log', '-1', '--format=%s'], options), 'Implement issue #40');
        pushed = true;
        return '';
      }
      return command(binary, args, options);
    }
    return mock(binary, args, options);
  }, run: async ({ current }) => {
    assert.equal(await readFile(join(current.worktree, 'example.txt'), 'utf8'), 'baseline\n');
    await writeFile(join(current.worktree, 'example.txt'), 'implementation\n');
    await writeFile(join(current.worktree, 'added.txt'), 'new content\n');
    return { code: 0, result };
  } });
  assert.equal(state.lastReason, 'completed');
  assert.ok(pushed);
  assert.equal(await readFile(join(root, 'example.txt'), 'utf8'), 'baseline\n');
  assert.equal(await git(['branch', '--show-current']), 'main');
});

test('protected files and RLS changes cannot be committed or published automatically', async t => {
  for (const changed of ['M\tsupabase/migrations/20260101000000_existing.sql', 'A\tsupabase/migrations/old/new.sql', 'A\tauth.json', 'M\tsrc/utils/permissions.ts']) {
    const path = await directory(t);
    const root = join(path, 'root'); await mkdir(root);
    const calls = [];
    const execute = mockExecute([issue(40)], calls);
    const state = await worker({ config: { ...config, stateDir: join(path, 'state') }, root, mode: 'once', report: () => {}, execute: async (binary, args, options) => {
      if (binary === 'git' && args[0] === 'diff') return changed;
      return execute(binary, args, options);
    }, run: async () => ({ code: 0, result }) });
    assert.equal(state.status, 'needs-human');
    assert.ok(!calls.some(([binary, args]) => binary === 'git' && ['commit', 'push'].includes(args[0])));
  }
});


const credentialNames = ['CODEX_HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST', 'SSH_AUTH_SOCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NPM_TOKEN'];
const credentialEnvironment = () => ({
  PATH: process.env.PATH, HOME: '/owner-home', CODEX_HOME: '/owner-codex',
  XDG_CONFIG_HOME: '/owner-config', GH_CONFIG_DIR: '/owner-gh',
  GH_TOKEN: 'dummy-gh-token', GITHUB_TOKEN: 'dummy-github-token', GH_HOST: 'github.com',
  SSH_AUTH_SOCK: '/owner-agent', OPENAI_API_KEY: 'dummy-openai-key', CODEX_API_KEY: 'dummy-codex-key',
  CODEX_ACCESS_TOKEN: 'dummy-codex-token', SUPABASE_SERVICE_ROLE_KEY: 'dummy-supabase-key',
  NPM_TOKEN: 'dummy-npm-token', npm_config_userconfig: '/owner-npmrc', GIT_CONFIG_GLOBAL: '/owner-gitconfig',
});

function assertNoCredentials(env, allowed = []) {
  for (const name of credentialNames) if (!allowed.includes(name)) assert.equal(env[name], undefined, name);
}

test('environment policies separate build, Codex and GitHub credential capabilities', () => {
  const source = credentialEnvironment();
  const build = safeEnvironment(source, { purpose: 'build', home: '/private-home' });
  assertNoCredentials(build);
  assert.equal(build.HOME, '/private-home');
  assert.equal(build.XDG_CONFIG_HOME, '/private-home/config');
  assert.equal(build.npm_config_userconfig, '/private-home/config/npmrc');
  assert.equal(build.npm_config_globalconfig, '/private-home/config/global-npmrc');
  assert.equal(build.GIT_CONFIG_GLOBAL, '/private-home/config/gitconfig');
  const codex = safeEnvironment(source, { purpose: 'codex' });
  assertNoCredentials(codex, ['CODEX_HOME']);
  assert.equal(codex.HOME, source.HOME);
  assert.equal(codex.CODEX_HOME, source.CODEX_HOME);
  assert.equal(codex.XDG_CONFIG_HOME, undefined);
  const github = safeEnvironment(source, { purpose: 'github', home: '/github-private-home' });
  assertNoCredentials(github, ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST', 'SSH_AUTH_SOCK']);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST', 'SSH_AUTH_SOCK']) assert.equal(github[name], source[name]);
  assert.equal(github.HOME, '/github-private-home');
  assert.equal(github.GIT_CONFIG_GLOBAL, source.GIT_CONFIG_GLOBAL);
  assert.equal(safeEnvironment({ HOME: '/owner-home', XDG_CONFIG_HOME: '/owner-config' }, { purpose: 'github', home: '/private-home' }).GH_CONFIG_DIR, '/owner-config/gh');
  assert.equal(safeEnvironment({ HOME: '/owner-home' }, { purpose: 'github', home: '/private-home' }).GH_CONFIG_DIR, '/owner-home/.config/gh');
  assert.throws(() => safeEnvironment(source), /separate absolute HOME/);
  assert.throws(() => safeEnvironment(source, { home: source.HOME }), /separate absolute HOME/);
  assert.throws(() => safeEnvironment(source, { purpose: 'untrusted' }), /Unknown subprocess purpose/);
});

test('real npm lifecycle, typecheck, lint and test subprocesses use fresh credential-free HOME/cache', async t => {
  const path = await directory(t);
  const packageData = { name: 'worker-env-fixture', version: '1.0.0', private: true, scripts: Object.fromEntries(['preinstall', 'typecheck', 'lint', 'test'].map(name => [name, 'node probe.mjs'])) };
  await writeFile(join(path, 'package.json'), JSON.stringify(packageData));
  await writeFile(join(path, 'package-lock.json'), JSON.stringify({ name: packageData.name, version: packageData.version, lockfileVersion: 3, requires: true, packages: { '': { name: packageData.name, version: packageData.version, hasInstallScript: true } } }));
  await writeFile(join(path, 'probe.mjs'), "import { writeFileSync, statSync } from 'node:fs'; writeFileSync('environment.json', JSON.stringify({ env: process.env, mode: statSync(process.env.HOME).mode & 0o777 }));");
  const homes = new Set();
  for (const args of [['ci', '--offline', '--no-audit', '--no-fund'], ['run', 'typecheck'], ['run', 'lint'], ['run', 'test']]) {
    await command('npm', args, { cwd: path, parentEnv: credentialEnvironment() });
    const { env, mode } = JSON.parse(await readFile(join(path, 'environment.json'), 'utf8'));
    assertNoCredentials(env);
    assert.notEqual(env.HOME, '/owner-home');
    assert.equal(mode, 0o700);
    assert.equal(env.npm_config_cache, join(env.HOME, 'cache/npm'));
    assert.equal(env.npm_config_userconfig, join(env.HOME, 'config/npmrc'));
    assert.equal(env.npm_config_globalconfig, join(env.HOME, 'config/global-npmrc'));
    assert.equal(env.GIT_CONFIG_GLOBAL, join(env.HOME, 'config/gitconfig'));
    assert.equal(env.XDG_CONFIG_HOME, join(env.HOME, 'config'));
    assert.ok(!homes.has(env.HOME)); homes.add(env.HOME);
    await assert.rejects(realpath(env.HOME), { code: 'ENOENT' });
  }
});

test('real Codex runner receives only Codex auth locations and no GitHub credentials', async t => {
  const path = await directory(t);
  const binary = join(path, 'fake-auth-codex.mjs');
  await writeFile(binary, '#!/usr/bin/env node\nprocess.stdin.resume();\nconsole.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:JSON.stringify(' + JSON.stringify(result).replace('"Implemented"', 'JSON.stringify(process.env)') + ')}}));\n', { mode: 0o700 });
  const outcome = await runCodex({ current: { number: 40, branch: 'codex/issue-40-task', worktree: path }, issue: issue(40), schemaPath: '/schema', tracePath: join(path, 'trace'), stderrPath: join(path, 'stderr'), binary, parentEnv: credentialEnvironment(), onSession: async () => {} });
  assert.equal(outcome.code, 0);
  const env = JSON.parse(outcome.result.summary);
  assertNoCredentials(env, ['CODEX_HOME']);
  assert.equal(env.HOME, '/owner-home');
  assert.equal(env.CODEX_HOME, '/owner-codex');
});

test('real GitHub subprocess receives GH/SSH capabilities without Codex auth locations', async t => {
  const path = await directory(t);
  const env = JSON.parse(await command(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], { cwd: path, purpose: 'github', parentEnv: credentialEnvironment() }));
  assertNoCredentials(env, ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST', 'SSH_AUTH_SOCK']);
  assert.equal(env.GH_CONFIG_DIR, '/owner-gh');
  assert.equal(env.SSH_AUTH_SOCK, '/owner-agent');
  assert.notEqual(env.HOME, '/owner-home');
});

test('worker routes authenticated fetch/push/gh and Codex separately from npm/local Git', async t => {
  const path = await directory(t);
  const root = join(path, 'root'); await mkdir(root);
  const calls = [];
  await worker({ config: { ...config, stateDir: join(path, 'state') }, root, mode: 'once', execute: mockExecute([issue(40)], calls), report: () => {}, run: async () => ({ code: 0, result }) });
  for (const [binary, args, options] of calls) {
    const expected = binary === 'codex' ? 'codex' : binary === 'gh' || (binary === 'git' && ['fetch', 'push'].includes(args[0])) ? 'github' : 'build';
    assert.equal(options?.purpose ?? 'build', expected, `${binary} ${args[0]}`);
  }
  assert.ok(calls.some(([binary, args]) => binary === 'git' && args[0] === 'fetch'));
  assert.ok(calls.some(([binary, args]) => binary === 'git' && args[0] === 'push'));
  assert.ok(calls.some(([binary, args]) => binary === 'npm' && args[0] === 'ci'));
});

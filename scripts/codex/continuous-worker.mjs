import { homedir } from 'node:os';
import { resolve, join, relative, isAbsolute, dirname, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, access, realpath } from 'node:fs/promises';
import { command } from './lib/process.mjs';
import { GitHub } from './lib/github.mjs';
import { branchName, disposition, labels, metadata, selectIssue } from './lib/queue.mjs';
import { loadState, lockState, saveJson } from './lib/state.mjs';
import { codexArgs, nextQuotaRetry, resultSchema, runCodex, validateResult } from './lib/codex-runner.mjs';

export function configuration(env = process.env) {
  const number = (key, fallback, minimum = 1) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    stateDir: resolve(env.CODEX_WORKER_STATE_DIR ?? join(homedir(), '.local/state/care-record-codex-worker')),
    repo: env.CODEX_WORKER_REPO,
    maxRunMs: number('CODEX_WORKER_MAX_RUN_MINUTES', 0, 0) * 60_000,
    maxRetries: number('CODEX_WORKER_MAX_RETRIES', 1, 0),
    quotaBackoffMs: number('CODEX_WORKER_QUOTA_BACKOFF_MINUTES', 15) * 60_000,
    quotaMaxBackoffMs: number('CODEX_WORKER_QUOTA_MAX_BACKOFF_MINUTES', 1440) * 60_000,
    weeklyBackoffMs: number('CODEX_WORKER_WEEKLY_BACKOFF_MINUTES', 720) * 60_000,
    pollMs: number('CODEX_WORKER_POLL_SECONDS', 60) * 1000,
    stopOnFailure: env.CODEX_WORKER_STOP_ON_FAILURE === 'true',
  };
}

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

async function canonicalPath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

async function verify(current, execute) {
  const run = args => execute('git', args, { cwd: current.worktree });
  if (await run(['branch', '--show-current']) !== current.branch) throw new Error('Worktree branch mismatch');
  const beforeChecks = await run(['status', '--porcelain']);
  const changed = (await run(['diff', '--name-status', '--no-renames', current.base])).split('\n').filter(Boolean);
  const untracked = (await run(['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  changed.push(...untracked.map(path => `A\t${path}`));
  if (!changed.length) throw new Error('No implementation changes');
  if (changed.some(line => /^(?!A\s)\S+\s+supabase\/migrations\//.test(line) || /\s+supabase\/migrations\/old\//.test(line) || /\s+(?:.*\/)?(?:\.env(?!\.example$)|auth\.json|WORKER-PROGRESS\.md|.*\.pem$)/.test(line))) throw new Error('Protected file changed');
  for (const args of [['run', 'typecheck'], ['run', 'lint', '--', '--max-warnings=0']]) await execute('npm', args, { cwd: current.worktree, timeout: 600_000 });
  if (changed.some(line => /\s+src\/(?:app\/actions|utils)\//.test(line))) await execute('npm', ['run', 'test:unit'], { cwd: current.worktree, timeout: 600_000 });
  if (changed.some(line => /\s+src\/components\/ui\//.test(line))) await execute('npm', ['run', 'test:ui'], { cwd: current.worktree, timeout: 600_000 });
  if (changed.some(line => /\s+scripts\/codex\//.test(line))) await execute('npm', ['run', 'test:codex-worker'], { cwd: current.worktree, timeout: 600_000 });
  // DB checks require human environment confirmation, not automatic migration application.
  if (changed.some(line => /\s+(?:supabase\/migrations\/|src\/utils\/permissions\.ts)/.test(line))) throw new Error('DB/RLS change requires human verification before publishing');
  const afterChecks = await run(['status', '--porcelain']);
  if (beforeChecks !== afterChecks) throw new Error('Verification changed worktree files');
  if (afterChecks) {
    await run(['add', '--all', '--', '.']);
    await run(['commit', '-m', `Implement issue #${current.number}`]);
  }
  if (Number(await run(['rev-list', '--count', `${current.base}..HEAD`])) < 1) throw new Error('No implementation commit');
  if (await run(['status', '--porcelain'])) throw new Error('Verification changed tracked files');
}

export async function worker({ config, mode = 'normal', resume = false, root = process.cwd(), execute = command, run = runCodex, now = Date.now, wait = sleep, signal, report = console.log }) {
  const originalExecute = execute;
  execute = (binary, args, options) => originalExecute(binary, args, { ...options, signal });
  config = { ...config, stateDir: await canonicalPath(config.stateDir) };
  if (mode === 'status') {
    const state = await loadState(config.stateDir);
    report(JSON.stringify({ status: state.status, paused: state.paused, issue: state.current?.number ?? null, branch: state.current?.branch ?? null,
      worktree: state.current?.worktree ?? null, lastReason: state.lastReason, quotaWaitStarted: state.quotaWaitStarted,
      nextRetryAt: state.nextRetryAt, failures: state.current?.failures ?? 0, remainingWork: state.current?.progress ?? state.current?.result?.remaining_work ?? null }, null, 2));
    return state;
  }
  root = await realpath(root);
  const local = relative(root, config.stateDir);
  if (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)) throw new Error('State directory must be outside the repository');
  const remote = await execute('git', ['remote', 'get-url', 'origin'], { cwd: root });
  const repo = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)?.[1];
  if (!repo || (config.repo && config.repo !== repo)) throw new Error('Origin must match the configured GitHub repository');
  const github = new GitHub(repo, execute);
  let state = await loadState(config.stateDir);
  if (state.repo && state.repo !== repo) throw new Error('Saved state belongs to another repository');
  const persist = () => saveJson(join(config.stateDir, 'state.json'), state);
  if (mode === 'dry-run') {
    const snapshot = await github.snapshot();
    const issue = state.current ? await github.issue(state.current.number) : selectIssue(snapshot.issues, snapshot.dependencies, snapshot.linked);
    const current = state.current ?? (issue ? { number: issue.number, branch: branchName(issue), worktree: join(config.stateDir, 'worktrees', `issue-${issue.number}`) } : null);
    report(JSON.stringify({ mode, issue: issue?.number ?? null, dependencies: issue ? metadataForReport(issue) : [], branch: current?.branch ?? null, status: state.status, nextRetryAt: state.nextRetryAt, paused: state.paused,
      commands: current ? [['git', 'fetch', 'origin', 'main'], ['git', 'worktree', 'add', '-b', current.branch, current.worktree, 'origin/main'], ['npm', 'ci'], ['codex', ...codexArgs(current, join(config.stateDir, 'result.schema.json'))], ['git', 'push', 'origin', current.branch], ['gh', 'pr', 'create', '--draft']] : [] }, null, 2));
    return state;
  }
  const unlock = await lockState(config.stateDir);
  try {
    // Reload after obtaining the lock; another process may have just completed.
    state = await loadState(config.stateDir);
    if (state.repo && state.repo !== repo) throw new Error('Saved state belongs to another repository');
    state.repo = repo;
    if (state.paused && !resume) { report('Worker paused. Review state and use --resume.'); return state; }
    if (resume) { state.paused = false; if (state.current) state.current.failures = 0; await persist(); }
    const execHelp = await execute('codex', ['exec', '--help'], { purpose: 'codex' });
    let resumeHelp = '';
    try { resumeHelp = await execute('codex', ['exec', 'resume', '--help'], { purpose: 'codex' }); } catch { /* Fall back to same worktree. */ }
    for (const flag of ['--json', '--output-schema']) if (!execHelp.includes(flag)) throw new Error('Codex CLI needs JSON and schema support for exec');
    const canResumeSession = ['--json', '--output-schema'].every(flag => resumeHelp.includes(flag));
    await execute('gh', ['auth', 'status'], { purpose: 'github' });
    await saveJson(join(config.stateDir, 'result.schema.json'), resultSchema);
    while (!signal?.aborted) {
      if (state.nextRetryAt !== null && now() < state.nextRetryAt) {
        if (mode === 'once') return state;
        await wait(Math.min(60_000, state.nextRetryAt - now()), signal);
        continue;
      }
      if (!state.current) {
        const snapshot = await github.snapshot();
        const issue = selectIssue(snapshot.issues, snapshot.dependencies, snapshot.linked);
        if (!issue) { state.status = 'idle'; await persist(); if (mode === 'once') return state; await wait(config.pollMs, signal); continue; }
        // Recheck before claiming; run only one worker per repository (documented).
        const fresh = await github.issue(issue.number);
        if (!selectIssue([fresh], snapshot.dependencies, snapshot.linked)) { if (mode === 'once') return state; await wait(config.pollMs, signal); continue; }
        state.current = { number: issue.number, branch: branchName(issue), worktree: join(config.stateDir, 'worktrees', `issue-${issue.number}`), failures: 0, quotaWaits: 0, stage: 'prepare', session: null };
        await persist();
      }
      const current = state.current;
      if (resolve(current.worktree) !== join(config.stateDir, 'worktrees', `issue-${current.number}`)) throw new Error('Unexpected worktree path in state');
      const issue = await github.issue(current.number);
      if (issue.state !== 'open' || labels(issue).some(n => ['codex:blocked', 'codex:failed', 'codex:needs-human'].includes(n))) {
        if (!resume) { state.paused = true; state.status = 'needs-human'; state.lastReason = 'needs_human'; await persist(); return state; }
        if (issue.state !== 'open' || labels(issue).includes('codex:blocked')) throw new Error('Current issue is closed or blocked');
        await github.gh(['issue', 'edit', String(current.number), '--repo', repo, '--remove-label', 'codex:failed', '--remove-label', 'codex:needs-human']);
      }
      await github.mark(current.number, 'running');
      if (current.stage === 'prepare') {
        await execute('git', ['fetch', 'origin', 'main'], { cwd: root, purpose: 'github' });
        current.base ??= await execute('git', ['rev-parse', 'origin/main'], { cwd: root });
        await persist();
        await mkdir(join(config.stateDir, 'worktrees'), { recursive: true, mode: 0o700 });
        let exists = true;
        try { await access(current.worktree); } catch { exists = false; }
        if (!exists) await execute('git', ['worktree', 'add', '-b', current.branch, current.worktree, current.base], { cwd: root });
        if (await execute('git', ['branch', '--show-current'], { cwd: current.worktree }) !== current.branch) throw new Error('Existing worktree branch mismatch');
        await execute('npm', ['ci'], { cwd: current.worktree, timeout: 600_000 });
        current.stage = 'implement';
        await persist();
      }
      if (current.stage !== 'publish') {
        if (signal?.aborted) break;
        state.status = 'running';
        state.nextRetryAt = null;
        state.lastReason = 'running';
        await persist();
        const runDir = join(config.stateDir, 'runs', `${current.number}-${now()}`);
        await mkdir(runDir, { recursive: true, mode: 0o700 });
        current.lastRun = runDir;
        if (!canResumeSession) current.session = null;
        await persist();
        const outcome = await run({ current, issue, schemaPath: join(config.stateDir, 'result.schema.json'), tracePath: join(runDir, 'trace.jsonl'), stderrPath: join(runDir, 'stderr.log'), signal, maxRunMs: config.maxRunMs,
          onSession: async session => { current.session = session; await persist(); } });
        outcome.result = validateResult(outcome.result);
        if (outcome.result) {
          await saveJson(join(runDir, 'result.json'), outcome.result);
          current.progress = outcome.result.remaining_work;
        }
        const status = disposition(outcome, current.failures, config);
        state.lastReason = status;
        if (status === 'completed') { current.result = outcome.result; current.stage = 'publish'; }
        else if (status === 'quota_wait') {
          state.status = 'quota-wait';
          state.quotaWaitStarted = now();
          state.nextRetryAt = nextQuotaRetry(outcome, current.quotaWaits, config, now());
          current.quotaWaits++;
          await persist();
          if (mode === 'once' || signal?.aborted) return state;
          continue;
        } else if (status === 'paused') {
          state.paused = !signal?.aborted;
          state.lastReason = signal?.aborted ? 'stopped' : 'paused';
          await persist();
          return state;
        } else if (status === 'retry') { current.failures++; await persist(); await wait(config.pollMs, signal); continue; }
        else {
          await github.mark(current.number, status);
          state.paused = status === 'needs_human' || config.stopOnFailure;
          state.status = status.replace('_', '-');
          await saveJson(join(config.stateDir, `issue-${current.number}.json`), current);
          if (!state.paused) state.current = null;
          await persist();
          if (state.paused || mode === 'once') return state;
          continue;
        }
        await persist();
      }
      try {
        await verify(current, execute);
        await execute('git', ['push', 'origin', `${current.branch}:${current.branch}`], { cwd: current.worktree, purpose: 'github' });
        current.pr = await github.draft(current, current.result);
        await persist();
        await github.mark(current.number, 'completed');
        await saveJson(join(config.stateDir, `issue-${current.number}.json`), current);
        state.current = null;
        state.status = 'idle';
        state.quotaWaitStarted = null;
        state.nextRetryAt = null;
        state.lastReason = 'completed';
        await persist();
        report(`Issue #${current.number}: Draft PR ${current.pr}`);
      } catch {
        // Preserve publish stage for idempotent recovery, never rerun Codex blindly.
        state.paused = true;
        state.status = 'needs-human';
        state.lastReason = 'needs_human';
        await persist();
        await github.mark(current.number, 'needs_human');
        report(`Issue #${current.number}: verification or publication needs human review.`);
        return state;
      }
      if (mode === 'once') return state;
    }
    state.lastReason = 'stopped';
    await persist();
    return state;
  } catch (error) {
    if (signal?.aborted) {
      state.lastReason = 'stopped';
      await persist();
      return state;
    }
    if (state.current) {
      state.status = 'needs-human'; state.paused = true; state.lastReason = 'operational_error';
      await persist();
      try { await github.mark(state.current.number, 'needs_human'); } catch { /* Preserve local recovery even if GitHub is unavailable. */ }
    }
    throw error;
  } finally { await unlock(); }
}

function metadataForReport(issue) {
  try { return metadata(issue.body).dependencies; } catch { return 'invalid metadata'; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  if (flags.some(f => !['--once', '--dry-run', '--resume', '--status'].includes(f)) || flags.filter(f => ['--once', '--dry-run', '--status'].includes(f)).length > 1) {
    console.error('Usage: continuous-worker.mjs [--once | --dry-run | --status] [--resume]');
    process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try { await worker({ config: configuration(), mode: flags.includes('--status') ? 'status' : flags.includes('--dry-run') ? 'dry-run' : flags.includes('--once') ? 'once' : 'normal', resume: flags.includes('--resume'), signal: controller.signal }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}

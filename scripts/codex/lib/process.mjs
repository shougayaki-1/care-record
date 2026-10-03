import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const purposes = new Set(['build', 'codex', 'github']);

export function safeEnvironment(env = process.env, { purpose = 'build', home } = {}) {
  if (!purposes.has(purpose)) throw new Error('Unknown subprocess purpose');
  const names = ['PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'];
  const common = { ...Object.fromEntries(names.filter(n => env[n]).map(n => [n, env[n]])), GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' };
  if (purpose === 'codex') {
    // ChatGPT auth/session discovery belongs only to Codex. Never forward GH/SSH or API-key auth.
    return { ...common, ...Object.fromEntries(['HOME', 'CODEX_HOME', 'TMPDIR'].filter(n => env[n]).map(n => [n, env[n]])) };
  }
  if (!home || !isAbsolute(home) || home === env.HOME) throw new Error('A separate absolute HOME is required');
  const isolated = {
    ...common, HOME: home, TMPDIR: join(home, 'tmp'),
    XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'),
    npm_config_cache: join(home, 'cache/npm'), npm_config_userconfig: join(home, 'config/npmrc'),
    npm_config_globalconfig: join(home, 'config/global-npmrc'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'config/gitconfig'),
  };
  if (purpose === 'build') return isolated;
  // gh uses its explicit config path; authenticated Git may use the owner's credential helpers.
  // HOME remains isolated, and CODEX_HOME is never inherited by GitHub operations.
  return {
    ...isolated,
    ...Object.fromEntries(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'SSH_AUTH_SOCK'].filter(n => env[n]).map(n => [n, env[n]])),
    GH_CONFIG_DIR: env.GH_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'gh'),
    GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL || join(env.HOME || homedir(), '.gitconfig'),
  };
}

export async function command(binary, args, { cwd, input, purpose = 'build', timeout = 120_000, signal, parentEnv = process.env } = {}) {
  if (!purposes.has(purpose)) throw new Error('Unknown subprocess purpose');
  // Per-process directories never reuse a HOME/cache that a previous script could populate.
  let privateHome;
  try {
    if (purpose !== 'codex') {
      privateHome = await mkdtemp(join(tmpdir(), 'care-record-worker-home-'));
      for (const path of ['tmp', 'config', 'cache', 'data']) await mkdir(join(privateHome, path), { mode: 0o700 });
    }
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Worker stopped')); return; }
      const child = spawn(binary, args, { cwd, env: safeEnvironment(parentEnv, { purpose, home: privateHome }), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let size = 0;
      let stopping = false;
      let escalation;
      const kill = sig => {
        try { if (process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Already exited. */ }
      };
      const stop = () => {
        if (stopping) return;
        stopping = true;
        kill('SIGTERM');
        escalation = setTimeout(() => kill('SIGKILL'), 30_000);
      };
      const timer = setTimeout(stop, timeout);
      const cleanup = () => { clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener('abort', stop); };
      signal?.addEventListener('abort', stop, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 20_000_000) stop(); else output += chunk; });
      // Do not forward potentially sensitive stderr or command arguments.
      child.stderr.resume();
      child.once('error', () => { cleanup(); reject(new Error(`${binary} could not start`)); });
      child.once('close', code => {
        cleanup();
        if (signal?.aborted) reject(new Error('Worker stopped'));
        else if (code === 0 && !stopping) resolve(output.trim());
        else reject(new Error(`${binary} command failed; inspect locally without publishing credentials`));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  } finally {
    if (privateHome) await rm(privateHome, { recursive: true, force: true });
  }
}

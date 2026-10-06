import { sandboxHandoff, localChecks } from './failure.mjs';
import { ModelSettingsError, validateModel, validateEffort } from './model-settings.mjs';

const excluded = new Set(['codex:blocked', 'codex:running', 'codex:failed', 'codex:needs-human']);

export function metadata(body = '') {
  body ??= '';
  const blocks = [...body.matchAll(/<!--\s*codex-queue\s*\n([\s\S]*?)-->/g)];
  const markers = [...body.matchAll(/<!--\s*codex-queue(?=\s|-->|$)/g)];
  if (!markers.length) return { dependencies: [], priority: undefined };
  if (blocks.length !== 1 || markers.length !== 1) throw new ModelSettingsError('invalid_queue_metadata');
  const value = blocks[0][1];
  const fields = new Map();
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = line.match(/^\s*(priority|depends_on|model|effort):[^\S\r\n]*(.*)$/);
    if (!field || fields.has(field[1])) throw new ModelSettingsError('invalid_queue_metadata');
    fields.set(field[1], field[2].trim());
  }
  const dependencies = fields.get('depends_on');
  if (fields.has('depends_on') && !/^\[[^\n]*\]$/.test(dependencies)) throw new Error('Invalid dependencies');
  let parsed;
  try { parsed = dependencies ? JSON.parse(dependencies) : []; }
  catch { throw new Error('Invalid dependencies'); }
  if (!Array.isArray(parsed) || parsed.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('Invalid dependencies');
  const priority = fields.get('priority');
  if (fields.has('priority') && !/^p[0-3]$/.test(priority)) throw new Error('Invalid priority');
  return { dependencies: [...new Set(parsed)], priority,
    ...(fields.has('model') ? { model: validateModel(fields.get('model')) } : {}),
    ...(fields.has('effort') ? { effort: validateEffort(fields.get('effort')) } : {}) };
}

export function labels(issue) {
  return (issue.labels ?? []).map(label => typeof label === 'string' ? label : label.name);
}

export function selectIssue(issues, dependencyStates, linkedIssues = new Set()) {
  const candidates = [];
  for (const issue of issues) {
    const names = labels(issue);
    if (issue.state.toLowerCase() !== 'open' || !names.includes('codex:ready') || names.some(n => excluded.has(n)) || linkedIssues.has(issue.number)) continue;
    let info;
    try { info = metadata(issue.body); } catch (error) {
      if (!(error instanceof ModelSettingsError)) continue;
      // Select invalid execution input only to escalate, never to run it.
      info = { dependencies: [], priority: undefined };
    }
    if (info.dependencies.some(n => dependencyStates.get(n)?.toLowerCase() !== 'closed')) continue;
    const ranks = names.filter(n => /^priority:p[0-3]$/.test(n)).map(n => Number(n.at(-1)));
    const rank = info.priority ? Number(info.priority[1]) : ranks.length ? Math.min(...ranks) : 4;
    candidates.push({ issue, rank });
  }
  return candidates.sort((a, b) => a.rank - b.rank || a.issue.number - b.issue.number)[0]?.issue ?? null;
}

export function branchName(issue) {
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48).replace(/-$/, '') || 'implementation';
  return `codex/issue-${issue.number}-${slug}`;
}

export function disposition(run, failures, config) {
  if (run.quota || run.result?.status === 'quota_wait') return 'quota_wait';
  if (run.interrupted || run.result?.status === 'paused') return 'paused';
  if (run.result?.reasons?.some(r => !['sandbox_capability', 'local_verification'].includes(r.category))) return 'needs_human';
  if (sandboxHandoff(run)) return 'completed';
  if (run.result?.reasons?.some(r => r.category === 'sandbox_capability')) return 'needs_human';
  if (!run.needsHuman && run.result?.reasons?.length && run.result.reasons.every(r => r.category === 'local_verification' && localChecks.includes(r.check))) return failures < config.maxRetries ? 'retry' : 'needs_human';
  if (run.needsHuman || run.result?.status === 'needs_human') return 'needs_human';
  if (run.code === 0 && run.result?.status === 'completed' && run.result.safe_to_open_pr) return 'completed';
  return failures < config.maxRetries ? 'retry' : 'needs_human';
}

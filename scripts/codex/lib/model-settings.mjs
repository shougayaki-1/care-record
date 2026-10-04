// Reviewed Codex CLI identifiers; never accept arbitrary config from queue input.
const models = new Set(['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']);
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const sources = new Set(['issue', 'worker-config', 'built-in']);
export const builtInSettings = Object.freeze({ resolvedModel: 'gpt-6.1-sol', resolvedEffort: 'medium', modelSource: 'built-in', effortSource: 'built-in' });

export class ModelSettingsError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export function validateModel(value) {
  if (!models.has(value)) throw new ModelSettingsError('invalid_model');
  return value;
}

export function validateEffort(value) {
  if (!efforts.has(value)) throw new ModelSettingsError('invalid_reasoning_effort');
  return value;
}

export function resolveModelSettings(info, config) {
  // Validate configured values even when metadata would override them.
  if (config.workerModel !== undefined) validateModel(config.workerModel);
  if (config.workerEffort !== undefined) validateEffort(config.workerEffort);
  return {
    resolvedModel: validateModel(info.model ?? config.workerModel ?? builtInSettings.resolvedModel),
    resolvedEffort: validateEffort(info.effort ?? config.workerEffort ?? builtInSettings.resolvedEffort),
    modelSource: info.model !== undefined ? 'issue' : config.workerModel !== undefined ? 'worker-config' : 'built-in',
    effortSource: info.effort !== undefined ? 'issue' : config.workerEffort !== undefined ? 'worker-config' : 'built-in',
  };
}

export function hasModelSettings(current) {
  return ['resolvedModel', 'resolvedEffort', 'modelSource', 'effortSource'].some(key => Object.hasOwn(current, key));
}

export function savedModelSettings(current) {
  validateModel(current.resolvedModel);
  validateEffort(current.resolvedEffort);
  if (!sources.has(current.modelSource) || !sources.has(current.effortSource)) throw new ModelSettingsError('invalid_model_settings_source');
  return { resolvedModel: current.resolvedModel, resolvedEffort: current.resolvedEffort, modelSource: current.modelSource, effortSource: current.effortSource };
}

export function executionStarted(current) {
  return (current.stage !== undefined && current.stage !== 'prepare') || Boolean(current.session || current.lastRun || current.progress || current.result || current.repair || current.quotaWaits || current.failures);
}

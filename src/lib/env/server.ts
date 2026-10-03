import 'server-only';

import { parseDeploymentEnv } from './schema';

let cachedEnv: ReturnType<typeof parseDeploymentEnv> | undefined;

export function getDeploymentEnv() {
  cachedEnv ??= parseDeploymentEnv(process.env);
  return cachedEnv;
}

export function validateDeploymentEnv(): void {
  getDeploymentEnv();
}

export function isAiImportEnabled(): boolean {
  return getDeploymentEnv().AI_IMPORT_ENABLED;
}

export function getAiExtractProvider(): 'gemini' | 'openai' {
  return getDeploymentEnv().AI_EXTRACT_PROVIDER;
}

export function areExternalIntegrationsEnabled(): boolean {
  return getDeploymentEnv().EXTERNAL_INTEGRATIONS_ENABLED;
}

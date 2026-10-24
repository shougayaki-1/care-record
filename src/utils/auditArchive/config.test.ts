import { describe, expect, it } from 'vitest';
import { archiveConfig } from './config';
const env = { APP_ENV: 'staging', AUDIT_ARCHIVE_MODE: 'inventory', GCS_AUDIT_BUCKET: 'care-record-staging-test-audit-worm', GCP_PROJECT_ID: 'staging-project', EXPECTED_GCP_PROJECT_ID: 'staging-project', AUDIT_CONTROL_OBJECT: 'control/staging/root.json', AUDIT_CONTROL_GENERATION: '9007199254740993', AUDIT_CONTROL_SHA256: 'a'.repeat(64), AUDIT_CONTROL_SIZE: '300' };
describe('archive environment isolation', () => {
  it('requires explicit mode, environment bucket and independently pinned receipt', () => {
    expect(archiveConfig(env).pinned.generation).toBe('9007199254740993');
    for (const overrides of [{ AUDIT_ARCHIVE_MODE: '' }, { GCS_AUDIT_BUCKET: 'care-record-archive-7y' }, { GCS_AUDIT_BUCKET: 'care-record-production-test-audit-worm' }, { EXPECTED_GCP_PROJECT_ID: 'production-project' }, { AUDIT_CONTROL_SHA256: '' }, { EXTERNAL_INTEGRATIONS_ENABLED: 'false' }]) {
      expect(() => archiveConfig({ ...env, ...overrides })).toThrow();
    }
  });
});

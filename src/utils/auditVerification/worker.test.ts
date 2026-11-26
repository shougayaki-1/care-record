import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({stat:vi.fn(),readFile:vi.fn(),store:vi.fn(),source:vi.fn(),run:vi.fn(),storage:vi.fn()}));
vi.mock('@google-cloud/storage', () => ({Storage: class { constructor(options: unknown) { mocks.storage(options); } }}));
vi.mock('node:fs/promises', () => ({stat:mocks.stat,readFile:mocks.readFile}));
vi.mock('@/utils/auditArchive/gcs', () => ({createArchiveStore:mocks.store}));
vi.mock('./remoteSource', () => ({createRemoteVerificationSource:mocks.source}));
vi.mock('./notify', () => ({runVerificationWithNotification:mocks.run}));
import { requireWorkloadIdentity, runVerificationWorker, verificationRequestId, verifierConfig } from './worker';

const env = {AUDIT_VERIFIER_ENABLED:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'shougayaki-1/care-record',
  GITHUB_SERVER_URL:'https://github.com',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',AUDIT_VERIFICATION_STARTED_AT:'2026-01-01T00:00:00Z',
  ACTIONS_ID_TOKEN_REQUEST_URL:'https://runner.actions.githubusercontent.com/token?api-version=1',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic-oidc',
  GOOGLE_APPLICATION_CREDENTIALS:'/synthetic/wif.json',CRON_SECRET:'synthetic',AUDIT_VERIFIER_ORIGIN:'https://example.test',
  DISCORD_ALERT_WEBHOOK_URL:'https://discord.com/api/webhooks/123/token',APP_ENV:'staging',AUDIT_ARCHIVE_MODE:'v2',
  GCS_AUDIT_BUCKET:'care-record-staging-test-audit-worm',GCP_PROJECT_ID:'project',EXPECTED_GCP_PROJECT_ID:'project',
  AUDIT_CONTROL_OBJECT:'control/staging/root.json',AUDIT_CONTROL_GENERATION:'9007199254740993',AUDIT_CONTROL_SHA256:'a'.repeat(64),AUDIT_CONTROL_SIZE:'100'};
const wif = JSON.stringify({type:'external_account',audience:'//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/test/providers/test',
  subject_token_type:'urn:ietf:params:oauth:token-type:jwt',token_url:'https://sts.googleapis.com/v1/token',credential_source:{url:'https://runner.actions.githubusercontent.com/token?api-version=1&audience=test',headers:{Authorization:'Bearer synthetic-oidc'},format:{type:'json',subject_token_field_name:'value'}}});
beforeEach(() => {
  vi.resetAllMocks(); mocks.stat.mockResolvedValue({size:wif.length}); mocks.readFile.mockResolvedValue(wif);
  mocks.store.mockReturnValue({store:'synthetic'}); mocks.source.mockReturnValue({source:'synthetic'});
  mocks.run.mockRejectedValue({category:'incomplete'});
});
describe('independent verification worker', () => {
  it('uses stable request IDs across retries and distinct IDs for separate attempts and environments', () => {
    const id=verificationRequestId('staging','123','1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(verificationRequestId('staging','123','1')).toBe(id);
    expect(verificationRequestId('staging','123','2')).not.toBe(id);
    expect(verificationRequestId('production','123','1')).not.toBe(id);
  });
  it('fails closed on disabled, cross-environment, static key, wrong repository and partial configuration', () => {
    for (const changes of [{AUDIT_VERIFIER_ENABLED:''},{GITHUB_ACTIONS:''},{GITHUB_REPOSITORY:'other/repo'},
      {GCP_SERVICE_ACCOUNT_KEY_JSON:'not-allowed'},{GCP_SERVICE_ACCOUNT_KEY_PATH:'/key'},
      {AUDIT_CONTROL_OBJECT:'control/production/root.json'},{AUDIT_RECOMPUTE_OBJECT:'control/staging/x'},
      {GITHUB_RUN_ID:'../1'},{AUDIT_ARCHIVE_MODE:'inventory'},{AUDIT_VERIFICATION_STARTED_AT:'2999-01-01T00:00:00Z'}]) {
      expect(() => verifierConfig({...env,...changes})).toThrow();
    }
  });
  it('accepts only bounded external account credential files without logging contents', async () => {
    await expect(requireWorkloadIdentity('/synthetic/wif.json',env)).resolves.toBeUndefined();
    for (const invalid of ['not-json',JSON.stringify({type:'service_account',private_key:'secret'}),wif.replace('https://sts.googleapis.com/v1/token','https://other.test/token'),wif.replace('runner.actions.githubusercontent.com','other.test'),wif.replace('Bearer synthetic-oidc','Bearer wrong')]) {
      mocks.readFile.mockResolvedValueOnce(invalid);
      await expect(requireWorkloadIdentity('/synthetic/wif.json',env)).rejects.toMatchObject({category:'not_configured',message:'not_configured'});
    }
    mocks.stat.mockResolvedValueOnce({size:32769});
    await expect(requireWorkloadIdentity('/synthetic/wif.json',env)).rejects.toMatchObject({category:'not_configured'});
  });
  it('connects trusted settings, stable request, independent storage boundaries and failure notifications', async () => {
    await expect(runVerificationWorker(env)).rejects.toMatchObject({category:'incomplete'});
    const config=verifierConfig(env);
    expect(mocks.source).toHaveBeenCalledWith(env.AUDIT_VERIFIER_ORIGIN,'staging',env.CRON_SECRET,config.requestId);
    expect(mocks.store).toHaveBeenCalledTimes(2);
    expect(mocks.storage).toHaveBeenCalledWith({projectId:'project',keyFilename:env.GOOGLE_APPLICATION_CREDENTIALS});
    expect(mocks.store).toHaveBeenCalledWith(env.GCS_AUDIT_BUCKET,'verification/staging/',expect.any(Object));
    expect(mocks.run).toHaveBeenCalledWith(config.metadata,{store:'synthetic'},{store:'synthetic'},config.archive.pinned,
      {source:'synthetic'},env.DISCORD_ALERT_WEBHOOK_URL,undefined);
  });
  it('does not construct stores or start a snapshot when WIF is unavailable', async () => {
    mocks.readFile.mockRejectedValueOnce(new Error('secret diagnostic'));
    await expect(runVerificationWorker(env)).rejects.toMatchObject({category:'not_configured',message:'not_configured'});
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
});

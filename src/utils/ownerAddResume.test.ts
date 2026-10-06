import { describe, expect, it } from 'vitest';
import { readOwnerAddResume } from './ownerAddResume';

const orgId = '85000000-0000-4000-8000-000000000001';
const actorId = '85000000-0000-4000-8000-000000000002';
const targetId = '85000000-0000-4000-8000-000000000003';
const stored = JSON.stringify({ orgId, actorId, targetId });
const params = () => new URLSearchParams({ stepup: '1', action: 'owner_add', reauthOrg: orgId, target: targetId });
describe('owner add SSO resume', () => {
  it('restores only the original actor, organization and target', () => {
    expect(readOwnerAddResume(params(), stored, orgId, actorId)).toEqual({ orgId, actorId, targetId });
  });
  it.each(['target', 'reauthOrg', 'action', 'stepup'])('rejects a changed %s', field => {
    const query = params(); query.set(field, actorId);
    expect(readOwnerAddResume(query, stored, orgId, actorId)).toBeNull();
  });
  it('rejects a changed workspace or actor, missing context and failed reauth', () => {
    expect(readOwnerAddResume(params(), stored, targetId, actorId)).toBeNull();
    expect(readOwnerAddResume(params(), stored, orgId, targetId)).toBeNull();
    expect(readOwnerAddResume(params(), null, orgId, actorId)).toBeNull();
    expect(readOwnerAddResume(params(), 'invalid json', orgId, actorId)).toBeNull();
    const query = params(); query.set('stepupError', '1');
    expect(readOwnerAddResume(query, stored, orgId, actorId)).toBeNull();
  });
});

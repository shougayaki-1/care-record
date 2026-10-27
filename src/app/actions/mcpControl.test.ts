import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/supabase/auth', () => ({
  assertOrgPermission: mocks.permission,
  createSessionClient: async () => ({ rpc: mocks.rpc }),
}));
import { getMcpImportControl, setMcpImportControl } from './mcpControl';

const conditions = { provider: 'provider', processing: 'terms', region: 'region', retention: 'retention', secondary_use: 'none', notice: 'explained' };
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue({}); mocks.rpc.mockResolvedValue({ data: null, error: null }); });

describe('MCP import settings', () => {
  it('requires integration permission before reading or changing settings', async () => {
    mocks.permission.mockRejectedValue(new Error('private permission detail'));
    const result = await setMcpImportControl('org', true, conditions, true);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private permission detail');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects missing conditions and missing explicit confirmation without calling the RPC', async () => {
    expect((await setMcpImportControl('org', true, { ...conditions, region: ' ' }, true)).ok).toBe(false);
    expect((await setMcpImportControl('org', false, null, false)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('sends validated conditions only after permission and confirmation', async () => {
    expect((await setMcpImportControl('org', true, conditions, true)).ok).toBe(true);
    expect(mocks.permission).toHaveBeenCalledWith('org', 'integrations');
    expect(mocks.rpc).toHaveBeenCalledWith('enable_mcp_import', { p_organization_id: 'org', p_conditions: conditions });
  });
  it('disables without deleting candidate data', async () => {
    expect((await setMcpImportControl('org', false, null, true)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('disable_mcp_import', { p_organization_id: 'org' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('fails closed on malformed status or database errors without exposing details', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { enabled: 'yes' }, error: null });
    expect((await getMcpImportControl('org')).ok).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private database detail', code: 'XX000' } });
    const result = await getMcpImportControl('org');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });
});

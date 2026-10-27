'use server';

import { z } from 'zod';
import { assertOrgPermission, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';
import { asJson } from '@/types/json';

const conditionsSchema = z.object({
  provider: z.string().trim().min(1).max(500),
  processing: z.string().trim().min(1).max(500),
  region: z.string().trim().min(1).max(500),
  retention: z.string().trim().min(1).max(500),
  secondary_use: z.string().trim().min(1).max(500),
  notice: z.string().trim().min(1).max(500),
}).strict();

export async function getMcpImportControl(organizationId: string) {
  return withActionResult('getMcpImportControl', async () => {
    await assertOrgPermission(organizationId, 'integrations');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_import_control', { p_organization_id: organizationId });
    if (error) throw sanitizeDbError(error, 'action.mcpControl.get');
    const parsed = z.object({ enabled: z.boolean(), conditions: conditionsSchema.nullable(), confirmed_at: z.string().nullable() }).safeParse(data);
    if (!parsed.success) throw new Error('Invalid MCP control response');
    return parsed.data;
  });
}

export async function setMcpImportControl(organizationId: string, enabled: boolean, conditions: unknown, confirmed: boolean) {
  return withActionResult('setMcpImportControl', async () => {
    await assertOrgPermission(organizationId, 'integrations');
    if (typeof enabled !== 'boolean' || confirmed !== true) throw new ExpectedActionError('VALIDATION_ERROR', '操作内容を確認してください');
    const session = await createSessionClient();
    if (enabled) {
      const parsed = conditionsSchema.safeParse(conditions);
      if (!parsed.success) throw new ExpectedActionError('VALIDATION_ERROR', 'すべての確認項目を入力してください');
      const { error } = await session.rpc('enable_mcp_import', { p_organization_id: organizationId, p_conditions: asJson(parsed.data) });
      if (error) throw sanitizeDbError(error, 'action.mcpControl.enable');
    } else {
      const { error } = await session.rpc('disable_mcp_import', { p_organization_id: organizationId });
      if (error) throw sanitizeDbError(error, 'action.mcpControl.disable');
    }
    return { enabled };
  });
}

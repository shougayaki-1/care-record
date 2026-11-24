'use server';
import { z } from 'zod';
import { getAuthedUser, createSessionClient } from '@/utils/supabase/auth';
import { ExpectedActionError, sanitizeDbError, withActionResult } from '@/utils/errors';

const id = z.string().uuid();
const preferences = z.object({ enabled: z.boolean(), frequency: z.enum(['daily', 'weekly']), pending_reports: z.boolean(), unassigned_shifts: z.boolean() });
export async function getBusinessAlertPreferences(organizationId: string) {
  return withActionResult('getBusinessAlertPreferences', async () => {
    await getAuthedUser();
    if (!id.safeParse(organizationId).success) throw new ExpectedActionError('VALIDATION_ERROR', '事業所を確認してください');
    const session = await createSessionClient();
    const { data, error } = await session.rpc('get_mcp_business_alert_preferences', { p_organization_id: organizationId });
    if (error) throw sanitizeDbError(error, 'business-alert.preferences.get');
    return preferences.parse(data);
  });
}
export async function setBusinessAlertPreferences(organizationId: string, input: z.input<typeof preferences>) {
  return withActionResult('setBusinessAlertPreferences', async () => {
    await getAuthedUser();
    const parsed = preferences.safeParse(input);
    if (!id.safeParse(organizationId).success || !parsed.success || (parsed.data.enabled && !parsed.data.pending_reports && !parsed.data.unassigned_shifts))
      throw new ExpectedActionError('VALIDATION_ERROR', '通知する内容を確認してください');
    const session = await createSessionClient();
    const { error } = await session.rpc('set_mcp_business_alert_preferences', { p_organization_id: organizationId,
      p_enabled: parsed.data.enabled, p_frequency: parsed.data.frequency, p_pending_reports: parsed.data.pending_reports, p_unassigned_shifts: parsed.data.unassigned_shifts });
    if (error?.code === '42501') throw new ExpectedActionError('FORBIDDEN', '選択した通知を受け取る権限がありません');
    if (error) throw sanitizeDbError(error, 'business-alert.preferences.set');
    return parsed.data;
  });
}

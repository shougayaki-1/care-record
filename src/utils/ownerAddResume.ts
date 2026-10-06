import { z } from 'zod';

export const OWNER_ADD_RESUME_KEY = 'care-record:owner-add';
const pendingSchema = z.object({ orgId: z.uuid(), targetId: z.uuid(), actorId: z.uuid() });

/** URLは対象選択の正本にしない。開始時の本人・事業所・対象と一致する復帰だけ許可する。 */
export function readOwnerAddResume(params: URLSearchParams, stored: string | null, orgId: string, actorId: string) {
  if (!stored || params.get('stepup') !== '1' || params.has('stepupError') || params.get('action') !== 'owner_add') return null;
  try {
    const pending = pendingSchema.parse(JSON.parse(stored));
    return pending.orgId === orgId && pending.actorId === actorId
      && pending.orgId === params.get('reauthOrg') && pending.targetId === params.get('target')
      && pending.targetId !== actorId ? pending : null;
  } catch { return null; }
}

import { fn } from 'storybook/test';
import type * as InternalWork from '../internalWork';

// Keep the Storybook form independent of server-only database/auth modules.
export const saveInternalWork = fn<typeof InternalWork.saveInternalWork>().mockResolvedValue({ ok: true, data: { success: true, id: 'work-1' } });

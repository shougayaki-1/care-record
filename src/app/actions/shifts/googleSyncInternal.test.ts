import { describe, expect, it, vi } from 'vitest';

import { deleteGoogleEventIfExists, type GoogleCalendarClient } from './googleSyncInternal';

function calendarWithDeleteResult(result: unknown): GoogleCalendarClient {
  return {
    events: {
      delete: vi.fn().mockImplementation(async () => result),
    },
  } as unknown as GoogleCalendarClient;
}

function calendarWithDeleteError(error: unknown): GoogleCalendarClient {
  return {
    events: {
      delete: vi.fn().mockRejectedValue(error),
    },
  } as unknown as GoogleCalendarClient;
}

describe('deleteGoogleEventIfExists', () => {
  it('reports a successful Google deletion', async () => {
    const calendar = calendarWithDeleteResult({ data: {} });

    await expect(deleteGoogleEventIfExists(calendar, 'calendar-1', 'event-1')).resolves.toBe(true);
    expect(calendar.events.delete).toHaveBeenCalledWith({ calendarId: 'calendar-1', eventId: 'event-1' });
  });

  it.each([404, 410])('treats HTTP %s as already deleted and retry-safe', async (status) => {
    const calendar = calendarWithDeleteError({ response: { status } });

    await expect(deleteGoogleEventIfExists(calendar, 'calendar-1', 'event-1')).resolves.toBe(false);
  });

  it('propagates a non-idempotent Google failure for the retry queue', async () => {
    const calendar = calendarWithDeleteError({ response: { status: 400 } });

    await expect(deleteGoogleEventIfExists(calendar, 'calendar-1', 'event-1')).rejects.toMatchObject({
      kind: 'permanent',
      code: 400,
    });
  });
});

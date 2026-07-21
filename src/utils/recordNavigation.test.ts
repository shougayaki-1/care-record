import { describe, expect, it } from 'vitest';
import { buildRecordPath } from './recordNavigation';

describe('buildRecordPath', () => {
  it('always includes a draftKey so record/[clientId]\'s normalizing router.replace never races a pending push', () => {
    const path = buildRecordPath('client-1');
    expect(path).toMatch(/^\/app\/record\/client-1\?draftKey=[^&]+$/);
  });

  it('carries through extra params and omits undefined ones', () => {
    const path = buildRecordPath('client-1', { shiftId: 'shift-1', segmentId: undefined });
    const url = new URL(path, 'http://localhost');
    expect(url.pathname).toBe('/app/record/client-1');
    expect(url.searchParams.get('shiftId')).toBe('shift-1');
    expect(url.searchParams.has('segmentId')).toBe(false);
    expect(url.searchParams.get('draftKey')).toBeTruthy();
  });

  it('generates a fresh draftKey on every call', () => {
    const a = new URL(buildRecordPath('client-1'), 'http://localhost').searchParams.get('draftKey');
    const b = new URL(buildRecordPath('client-1'), 'http://localhost').searchParams.get('draftKey');
    expect(a).not.toBe(b);
  });
});

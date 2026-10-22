import { afterEach, describe, expect, it } from 'vitest';
import { markRecordBodyVisible, measureRecordLoad } from './recordLoadTiming';

afterEach(() => performance.clearMeasures());

describe('record load timings', () => {
  it('retains one duration per stage without storing the payload', async () => {
    const payload = { note: 'private body', url: 'https://example.invalid/private' };
    expect(await measureRecordLoad('images', () => Promise.resolve(payload))).toBe(payload);
    await measureRecordLoad('images', () => Promise.resolve(payload));
    const entries = performance.getEntriesByName('record-load:images');
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('private');
    expect(entries[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('preserves the failure while recording its duration', async () => {
    const error = new Error('synthetic failure');
    await expect(measureRecordLoad('audit', () => Promise.reject(error))).rejects.toBe(error);
    expect(performance.getEntriesByName('record-load:audit')).toHaveLength(1);
  });

  it('measures form visibility from initialization, excluding attachment completion', async () => {
    markRecordBodyVisible();
    expect(performance.getEntriesByName('record-load:body-visible')).toHaveLength(0);
    await measureRecordLoad('ready', () => Promise.resolve());
    markRecordBodyVisible();
    const ready = performance.getEntriesByName('record-load:ready')[0];
    const visible = performance.getEntriesByName('record-load:body-visible')[0];
    expect(visible.startTime).toBe(ready.startTime);
    expect(visible.duration).toBeGreaterThanOrEqual(ready.duration);
  });
});

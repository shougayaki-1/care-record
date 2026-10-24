// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadBlob } from './downloadBlob';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([false, true])('releases the Object URL and anchor even if clicking fails (%s)', (fails) => {
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => 'blob:owned');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    expect(document.querySelector('a')?.download).toBe('export.csv');
    if (fails) throw new Error('click failed');
  });
  const action = () => downloadBlob(new Blob(['data']), 'export.csv');
  if (fails) expect(action).toThrow('click failed'); else action();
  expect(document.querySelector('a')).toBeNull();
  vi.runAllTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned');
});

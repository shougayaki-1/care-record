import { afterEach, expect, it, vi } from 'vitest';
import { withinDeadline } from './deadline';

afterEach(() => vi.useRealTimers());
it('aborts the operation and reports incomplete when the deadline expires', async () => {
  vi.useFakeTimers();
  let aborted=false;
  const pending=withinDeadline(signal => new Promise<void>((_,reject) => {
    signal.addEventListener('abort',() => { aborted=true; reject(new Error('private transport detail')); });
  }),Date.now()+100);
  const result=expect(pending).rejects.toMatchObject({category:'incomplete',message:'incomplete'});
  await vi.advanceTimersByTimeAsync(101);
  await result;
  expect(aborted).toBe(true);
});

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

it('does not start an operation when its parent was already cancelled', async () => {
  const parent=new AbortController(); parent.abort();
  const operation=vi.fn(async () => 'unexpected');
  await expect(withinDeadline(operation,Date.now()+1000,parent.signal)).rejects.toMatchObject({category:'incomplete'});
  expect(operation).not.toHaveBeenCalled();
});
it('propagates parent cancellation to an already running operation', async () => {
  const parent=new AbortController(); let aborted=false;
  const pending=withinDeadline(signal => new Promise<void>((_,reject) => {
    signal.addEventListener('abort',() => { aborted=true; reject(new Error('private detail')); });
  }),Date.now()+1000,parent.signal);
  parent.abort();
  await expect(pending).rejects.toMatchObject({category:'incomplete',message:'incomplete'});
  expect(aborted).toBe(true);
});

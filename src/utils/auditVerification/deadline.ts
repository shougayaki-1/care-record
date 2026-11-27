import { ArchiveFailure } from '@/utils/auditArchive/contracts';

export async function withinDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, deadline: number, parent?: AbortSignal): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || parent?.aborted) throw new ArchiveFailure('incomplete');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      const fail = () => { reject(new ArchiveFailure('incomplete')); controller.abort(); };
      timer = setTimeout(fail, remaining);
      onAbort = fail;
      parent?.addEventListener('abort', fail, { once:true });
      if (parent?.aborted) fail();
    });
    if (controller.signal.aborted) return await interrupted;
    return await Promise.race([operation(controller.signal), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

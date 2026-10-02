/** One refresh boundary for committed records; no record content is cached here. */
const listeners = new Set<{ organizationId: string; refresh: () => Promise<unknown> }>();

export function subscribeRecordFeed(organizationId: string, refresh: () => Promise<unknown>) {
  const listener = { organizationId, refresh };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refreshRecordFeeds(organizationId: string) {
  // A refresh error must never turn a committed save into a failed write.
  await Promise.allSettled([...listeners].filter((listener) => listener.organizationId === organizationId)
    .map((listener) => Promise.resolve().then(listener.refresh)));
}

export async function commitRecordChange<T>(organizationId: string, operation: () => Promise<T>, hasCommittedChange: (result: T) => boolean = () => true): Promise<T> {
  const result = await operation();
  if (hasCommittedChange(result)) await refreshRecordFeeds(organizationId);
  return result;
}

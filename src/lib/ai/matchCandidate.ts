/** Match only a single unambiguous name after normalizing Japanese spacing and width. */
export function matchCandidateName<T extends { id: string; name: string }>(
  name: string,
  candidates: T[],
): T | null {
  const normalized = name.normalize('NFKC').replace(/\s+/g, '');
  if (!normalized) return null;
  const matches = candidates.filter((candidate) =>
    candidate.name.normalize('NFKC').replace(/\s+/g, '') === normalized,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function matchesSelectedClient(
  readName: string,
  candidateId: string | null,
  clients: { id: string; name: string }[],
): boolean {
  if (clients.length !== 1) return false;
  const selected = clients[0];
  return matchCandidateName(readName, clients)?.id === selected.id &&
    (!candidateId || candidateId === selected.id);
}

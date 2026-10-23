'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRequestGeneration } from './useRequestGeneration';

export type AiImportCandidate = { id: string; name: string };
type Candidates = { clients: AiImportCandidate[]; helpers: AiImportCandidate[] };
type CandidateState = { organizationId: string | undefined } & (
  | { status: 'loading' | 'error'; clients: AiImportCandidate[]; helpers: AiImportCandidate[] }
  | { status: 'success' } & Candidates
);

/** Publish both lists together, only for the current organization and request. */
export function useAiImportCandidates(organizationId: string | undefined) {
  const [state, setState] = useState<CandidateState>({ organizationId, status: 'loading', clients: [], helpers: [] });
  const { next, invalidate, isCurrent } = useRequestGeneration();
  const load = useCallback(async () => {
    const generation = next();
    if (!organizationId) return;
    try {
      const [clients, helpers] = await Promise.all([
        supabase.from('clients').select('id, name').eq('organization_id', organizationId).is('archived_at', null).order('name', { ascending: true }),
        supabase.from('staffs').select('id, name').eq('organization_id', organizationId).is('archived_at', null).order('name', { ascending: true }),
      ]);
      if (!isCurrent(generation)) return;
      if (clients.error || helpers.error || !clients.data || !helpers.data) {
        setState({ organizationId, status: 'error', clients: [], helpers: [] });
        return;
      }
      setState({ organizationId, status: 'success', clients: clients.data, helpers: helpers.data });
    } catch {
      if (isCurrent(generation)) setState({ organizationId, status: 'error', clients: [], helpers: [] });
    }
  }, [organizationId, next, isCurrent]);

  const retry = useCallback(() => {
    setState({ organizationId, status: 'loading', clients: [], helpers: [] });
    return load();
  }, [organizationId, load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      invalidate();
    };
  }, [load, invalidate]);

  // Hide the former scope during render, before Effect cleanup runs.
  const current: CandidateState = state.organizationId === organizationId
    ? state : { organizationId, status: 'loading', clients: [], helpers: [] };
  if (state.organizationId !== organizationId) setState(current);
  return { ...current, retry };
}

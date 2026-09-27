-- The currently deployed app deletes a candidate after saving it as a draft.
-- Keep that existing operation available until the new manager-review app is
-- live. A follow-up migration removes this compatibility policy after cutover.
create policy "Delete own AI import candidates" on public.ai_import_candidates
  for delete to authenticated using (
    created_by = (select auth.uid())
    and (select private.is_session_active())
    and private.is_org_member(organization_id)
    and (auth.jwt() ->> 'client_id') is null
  );
grant delete on public.ai_import_candidates to authenticated;

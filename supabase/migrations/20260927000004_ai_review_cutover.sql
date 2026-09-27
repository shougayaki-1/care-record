-- The manager-review app is live. Only its reviewer RPC may discard a
-- submitted AI candidate; remove the old sender-side draft cleanup path.
drop policy if exists "Delete own AI import candidates" on public.ai_import_candidates;
revoke delete on public.ai_import_candidates from authenticated;

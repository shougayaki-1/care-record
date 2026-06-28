## Status: DONE

## Commits: 4fef42e

## Tests: npm run typecheck — no errors

## Changes
- Merged `organization_member_roles(organization_roles(permissions))` into the `organization_members` select query.
- Removed the sequential `organization_member_roles` Supabase query block (~43 lines removed).
- `parsedMembers` now carries `memberRoles`; permissions extracted inline via `flatMap` in the list-building loop.
- Net: 3RTT → 2RTT on workspace load path. Logic for owner/member permission resolution unchanged.

## Concerns: none

---

## Follow-up Fix (commit 21fd88d)

### Fix 1 — Removed redundant inner guard in for-loop
The pre-loop `parsedMembers.some(...)` check already catches invalid org/role before the loop runs, making the identical guard inside the loop dead code. Removed lines 144-148; the `isCurrent()` issue is eliminated by removal rather than addition.

### Fix 2 — JWT/401 detection in memberError || profileError branch
Added JWT error detection: if `authErr.code === '401'` or `authErr.message` contains `'jwt'`, sets `status('session_expired')` with appropriate message instead of generic `'error'`. Restores parity with the old separate `organization_member_roles` query that handled JWT errors.

### Typecheck: npm run typecheck — no errors

-- Add role-managed scopes for internal work records.
-- "assigned" means the signed-in user's linked staff record; "all" means any staff in the organization.

UPDATE public.organization_roles
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{internalWork}',
  CASE
    WHEN is_preset AND name = '管理者' THEN '{"view":"all","create":"all"}'::jsonb
    WHEN is_preset AND name = 'スタッフ' THEN '{"view":"assigned","create":"assigned"}'::jsonb
    ELSE COALESCE(permissions -> 'internalWork', '{"view":"assigned","create":"assigned"}'::jsonb)
  END,
  true
)
WHERE permissions -> 'internalWork' IS NULL
   OR (is_preset AND name IN ('管理者', 'スタッフ'));

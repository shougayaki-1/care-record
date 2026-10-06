-- Shift deletion reads the policy through the caller's session client.
-- Expose only the lookup fields; policy approval/write access stays server-only.
REVOKE ALL ON TABLE public.retention_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL (organization_id, resource_type, retention_years, legal_basis, reviewed_at, reviewed_by)
  ON TABLE public.retention_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT (organization_id, resource_type, retention_years, legal_basis)
  ON TABLE public.retention_policies TO authenticated;
GRANT ALL ON TABLE public.retention_policies TO service_role;

CREATE POLICY "Shift deleters read their organization retention policy"
  ON public.retention_policies FOR SELECT TO authenticated
  USING (
    resource_type = 'shift'
    AND (SELECT private.is_session_active())
    AND private.is_org_member(organization_id)
    AND private.get_member_shift_action_scope(organization_id, (SELECT auth.uid()), 'delete') = 'all'
    AND EXISTS (SELECT 1 FROM public.organizations o
      WHERE o.id = organization_id AND o.deleted_at IS NULL)
  );

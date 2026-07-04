-- Align RLS with the app's flexible RolePermissions model.
-- Keep legacy is_org_admin narrow so older permissive policies cannot grant broad access.

CREATE OR REPLACE FUNCTION "private"."has_management_permission"("p_org_id" "uuid", "p_user_id" "uuid", "p_area" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = p_user_id
      AND om.role = 'owner'
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_member_roles omr
    JOIN public.organization_roles r ON r.id = omr.role_id
    WHERE omr.organization_id = p_org_id
      AND omr.user_id = p_user_id
      AND COALESCE(r.permissions -> 'management' ->> p_area, 'false') = 'true'
  );
$$;

CREATE OR REPLACE FUNCTION "public"."is_org_admin"("_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _org_id
      AND om.user_id = auth.uid()
      AND om.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION "private"."can_manage_any_org_settings"("p_org_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT private.has_management_permission(p_org_id, p_user_id, 'organization')
      OR private.has_management_permission(p_org_id, p_user_id, 'integrations')
      OR private.has_management_permission(p_org_id, p_user_id, 'organizationDelete')
      OR private.has_management_permission(p_org_id, p_user_id, 'ownerTransfer');
$$;

CREATE OR REPLACE FUNCTION "private"."can_access_client"("p_client_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH target AS (
    SELECT c.id, c.organization_id
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.deleted_at IS NULL
  ),
  scope AS (
    SELECT
      t.*,
      private.get_member_record_view_scope(t.organization_id, auth.uid()) AS record_scope
    FROM target t
    WHERE EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = t.organization_id
        AND om.user_id = auth.uid()
    )
  )
  SELECT EXISTS (
    SELECT 1
    FROM scope s
    WHERE s.record_scope = 'all'
      OR private.has_management_permission(s.organization_id, auth.uid(), 'clients')
      OR private.has_management_permission(s.organization_id, auth.uid(), 'reports')
      OR (
        s.record_scope = 'assigned'
        AND private.is_assigned_client_for_user(s.id, s.organization_id, auth.uid())
      )
  );
$$;

CREATE OR REPLACE FUNCTION "private"."get_member_internal_work_scope"("p_org_id" "uuid", "p_user_id" "uuid", "p_action" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN om.role = 'owner' THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'internalWork' ->> p_action) = 'all'
        ) THEN 'all'
        WHEN EXISTS (
          SELECT 1
          FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id = omr.role_id
          WHERE omr.organization_id = p_org_id
            AND omr.user_id = p_user_id
            AND (r.permissions -> 'internalWork' ->> p_action) = 'assigned'
        ) THEN 'assigned'
        ELSE 'none'
      END
      FROM public.organization_members om
      WHERE om.organization_id = p_org_id
        AND om.user_id = p_user_id
    ),
    'none'
  );
$$;

DROP POLICY IF EXISTS "Internal work visible to org members" ON "public"."internal_work_records";
CREATE POLICY "Internal work visible by flexible role" ON "public"."internal_work_records"
  FOR SELECT TO "authenticated"
  USING (
    deleted_at IS NULL
    AND (
      private.get_member_internal_work_scope(organization_id, auth.uid(), 'view') = 'all'
      OR (
        private.get_member_internal_work_scope(organization_id, auth.uid(), 'view') = 'assigned'
        AND staff_id = private.get_actor_staff_id(organization_id, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Admin update invitations" ON "public"."invitations";
DROP POLICY IF EXISTS "Create invitations" ON "public"."invitations";
CREATE POLICY "Accounts managers update invitations" ON "public"."invitations"
  FOR UPDATE USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'accounts'));
CREATE POLICY "Accounts managers create invitations" ON "public"."invitations"
  FOR INSERT WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'accounts'));

DROP POLICY IF EXISTS "Admins insert members" ON "public"."organization_members";
DROP POLICY IF EXISTS "Manage members" ON "public"."organization_members";
CREATE POLICY "Accounts managers insert members" ON "public"."organization_members"
  FOR INSERT TO "authenticated" WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'accounts'));
CREATE POLICY "Accounts managers update members" ON "public"."organization_members"
  FOR UPDATE USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'accounts'));
CREATE POLICY "Accounts managers delete members" ON "public"."organization_members"
  FOR DELETE USING (private.has_management_permission(organization_id, auth.uid(), 'accounts'));

DROP POLICY IF EXISTS "Manage clients" ON "public"."clients";
CREATE POLICY "Client managers mutate clients" ON "public"."clients"
  FOR ALL USING (private.has_management_permission(organization_id, auth.uid(), 'clients'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'clients'));

DROP POLICY IF EXISTS "Manage staffs" ON "public"."staffs";
DROP POLICY IF EXISTS "Enable insert for admins" ON "public"."staffs";
CREATE POLICY "Staff managers mutate staffs" ON "public"."staffs"
  FOR ALL USING (private.has_management_permission(organization_id, auth.uid(), 'staffs'))
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'staffs'));

DROP POLICY IF EXISTS "Manage templates" ON "public"."form_templates";
CREATE POLICY "Client managers mutate templates" ON "public"."form_templates"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = form_templates.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = form_templates.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  );

DROP POLICY IF EXISTS "Allow insert for owners and managers" ON "public"."assignments";
DROP POLICY IF EXISTS "Allow delete for owners and managers" ON "public"."assignments";
CREATE POLICY "Client managers insert assignments" ON "public"."assignments"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = assignments.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  );
CREATE POLICY "Client managers update assignments" ON "public"."assignments"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = assignments.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = assignments.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  );
CREATE POLICY "Client managers delete assignments" ON "public"."assignments"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = assignments.client_id
        AND private.has_management_permission(c.organization_id, auth.uid(), 'clients')
    )
  );

DROP POLICY IF EXISTS "Update orgs" ON "public"."organizations";
CREATE POLICY "Organization settings managers update orgs" ON "public"."organizations"
  FOR UPDATE USING (private.can_manage_any_org_settings(id, auth.uid()))
  WITH CHECK (private.can_manage_any_org_settings(id, auth.uid()));

DROP POLICY IF EXISTS "Admins can insert shifts" ON "public"."shifts";
DROP POLICY IF EXISTS "Admins can update shifts" ON "public"."shifts";
DROP POLICY IF EXISTS "Admins can delete shifts" ON "public"."shifts";
CREATE POLICY "Shift creators insert shifts" ON "public"."shifts"
  FOR INSERT WITH CHECK (private.get_member_shift_action_scope(organization_id, auth.uid(), 'create') = 'all');
CREATE POLICY "Shift editors update shifts" ON "public"."shifts"
  FOR UPDATE USING (private.get_member_shift_action_scope(organization_id, auth.uid(), 'edit') = 'all')
  WITH CHECK (private.get_member_shift_action_scope(organization_id, auth.uid(), 'edit') = 'all');
CREATE POLICY "Shift deleters delete shifts" ON "public"."shifts"
  FOR DELETE USING (private.get_member_shift_action_scope(organization_id, auth.uid(), 'delete') = 'all');

DROP POLICY IF EXISTS "Manage shift_patterns" ON "public"."shift_patterns";
CREATE POLICY "Shift creators insert patterns" ON "public"."shift_patterns"
  FOR INSERT WITH CHECK (private.get_member_shift_action_scope(organization_id, auth.uid(), 'create') = 'all');
CREATE POLICY "Shift editors update patterns" ON "public"."shift_patterns"
  FOR UPDATE USING (private.get_member_shift_action_scope(organization_id, auth.uid(), 'edit') = 'all')
  WITH CHECK (private.get_member_shift_action_scope(organization_id, auth.uid(), 'edit') = 'all');
CREATE POLICY "Shift deleters delete patterns" ON "public"."shift_patterns"
  FOR DELETE USING (private.get_member_shift_action_scope(organization_id, auth.uid(), 'delete') = 'all');

DROP POLICY IF EXISTS "Users can insert shift_staffs in their org" ON "public"."shift_staffs";
DROP POLICY IF EXISTS "Users can delete shift_staffs in their org" ON "public"."shift_staffs";
DROP POLICY IF EXISTS "Admins can insert shift_staffs" ON "public"."shift_staffs";
DROP POLICY IF EXISTS "Admins can delete shift_staffs" ON "public"."shift_staffs";
CREATE POLICY "Shift editors insert shift staffs" ON "public"."shift_staffs"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_staffs.shift_id
        AND private.get_member_shift_action_scope(s.organization_id, auth.uid(), 'edit') = 'all'
    )
  );
CREATE POLICY "Shift editors delete shift staffs" ON "public"."shift_staffs"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_staffs.shift_id
        AND private.get_member_shift_action_scope(s.organization_id, auth.uid(), 'edit') = 'all'
    )
  );

DROP POLICY IF EXISTS "Manage shift_pattern_staffs" ON "public"."shift_pattern_staffs";
CREATE POLICY "Shift editors mutate pattern staffs" ON "public"."shift_pattern_staffs"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.shift_patterns sp
      WHERE sp.id = shift_pattern_staffs.pattern_id
        AND private.get_member_shift_action_scope(sp.organization_id, auth.uid(), 'edit') = 'all'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shift_patterns sp
      WHERE sp.id = shift_pattern_staffs.pattern_id
        AND private.get_member_shift_action_scope(sp.organization_id, auth.uid(), 'edit') = 'all'
    )
  );

GRANT EXECUTE ON FUNCTION "private"."has_management_permission"("uuid", "uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."can_manage_any_org_settings"("uuid", "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."get_member_internal_work_scope"("uuid", "uuid", "text") TO "authenticated";

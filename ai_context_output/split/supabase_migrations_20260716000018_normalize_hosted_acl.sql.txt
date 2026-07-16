-- Normalize Hosted Supabase defaults to the least-privilege ACL verified by
-- the empty local database. Platform defaults may otherwise grant anon and
-- authenticated roles privileges that were never intended by the migrations.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- New application objects must start closed. Every client-facing privilege is
-- granted explicitly in a migration and remains protected by RLS/RPC checks.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.assignments TO authenticated;
GRANT SELECT ON TABLE public.audit_events TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.audit_logs TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.clients TO authenticated;
GRANT SELECT ON TABLE public.deletion_requests TO authenticated;
GRANT SELECT ON TABLE public.form_templates TO authenticated;
GRANT INSERT, SELECT ON TABLE public.internal_work_records TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.invitations TO authenticated;
GRANT INSERT, SELECT ON TABLE public.labor_premium_types TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.notifications TO authenticated;
GRANT DELETE, INSERT, SELECT ON TABLE public.organization_member_roles TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.organization_members TO authenticated;
GRANT SELECT ON TABLE public.organization_roles TO authenticated;
GRANT INSERT, SELECT ON TABLE public.organizations TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.report_actual_staffs TO authenticated;
GRANT SELECT ON TABLE public.report_corrections TO authenticated;
GRANT INSERT, SELECT ON TABLE public.report_images TO authenticated;
GRANT SELECT ON TABLE public.report_shifts TO authenticated;
GRANT SELECT ON TABLE public.report_values TO authenticated;
GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT INSERT, SELECT ON TABLE public.service_types TO authenticated;
GRANT SELECT ON TABLE public.shift_pattern_segment_staffs TO authenticated;
GRANT SELECT ON TABLE public.shift_pattern_segments TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.shift_pattern_staffs TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.shift_patterns TO authenticated;
GRANT SELECT ON TABLE public.shift_segment_staffs TO authenticated;
GRANT SELECT ON TABLE public.shift_segments TO authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.shift_staffs TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.shifts TO authenticated;
GRANT DELETE, INSERT, SELECT ON TABLE public.staff_position_presets TO authenticated;
GRANT INSERT, SELECT ON TABLE public.staff_roles TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE public.staffs TO authenticated;
GRANT INSERT ON TABLE public.user_deletion_requests TO authenticated;
GRANT SELECT ON TABLE public.user_session_activity TO authenticated;

GRANT UPDATE (name, is_enabled, rate, calc_method, night_start_hour, night_end_hour, overtime_daily_threshold_hours, overtime_weekly_threshold_hours, updated_at, variable_working_hours_enabled, variable_overtime_period, variable_overtime_threshold_hours) ON TABLE public.labor_premium_types TO authenticated;
GRANT UPDATE (name, is_active, sort_order, deleted_at) ON TABLE public.service_types TO authenticated;
GRANT UPDATE (name, is_unpaid, is_active, sort_order, deleted_at) ON TABLE public.staff_roles TO authenticated;

GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_remove(p_organization_id uuid, p_target_id uuid, p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_replace_member_roles(p_organization_id uuid, p_target_user_id uuid, p_role_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_update_role(p_organization_id uuid, p_target_id uuid, p_status text, p_new_role text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_report_shift_link(p_org_id uuid, p_report_id uuid, p_shift_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_google_oauth_connection(p_org_id uuid, p_encrypted_refresh_token text, p_calendar_id text, p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation_authorized(p_organization_id uuid, p_code text, p_email text, p_target_name text, p_role_ids uuid[], p_staff_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_labor_premium_type_atomic(p_organization_id uuid, p_name text, p_rate numeric, p_calc_method text, p_night_start_hour smallint, p_night_end_hour smallint, p_variable_working_hours_enabled boolean, p_variable_overtime_period text, p_variable_overtime_threshold_hours numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(org_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_type_atomic(p_organization_id uuid, p_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_role_atomic(p_organization_id uuid, p_name text, p_is_unpaid boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_report_deletion(p_org_id uuid, p_request_id uuid, p_decision text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shift_segment_atomic(p_org_id uuid, p_segment_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_report_autosave_authorized(p_organization_id uuid, p_draft_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_report_image_upload(p_reservation_id uuid, p_completed boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_assignment_permission_hints_authorized(p_organization_id uuid, p_client_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_oauth_context(p_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_sync_target(p_org_id uuid, p_shift_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(p_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_organization_atomic(p_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_report_autosave_authorized(p_organization_id uuid, p_draft_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_shift_google_sync(p_shift_id uuid, p_status text, p_event_id text, p_set_event_id boolean, p_error text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_organization_role_authorized(p_organization_id uuid, p_role_id uuid, p_action text, p_name text, p_color text, p_permissions jsonb, p_require_preset boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_report_shift_link(p_org_id uuid, p_report_id uuid, p_shift_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_staffs_authorized(p_organization_id uuid, p_staff_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_client_assignments_authorized(p_organization_id uuid, p_client_id uuid, p_staff_ids uuid[], p_distances jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_generated_shift_segments_atomic(p_shift_id uuid, p_segments jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_pattern_segments_atomic(p_pattern_id uuid, p_segments jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_pattern_staffs_atomic(p_pattern_id uuid, p_staff_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_shift_segments(p_org_id uuid, p_shift_id uuid, p_segments jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_shift_staffs_atomic(p_shift_id uuid, p_staff_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_own_account_deletion(p_retention_basis text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_report_deletion(p_org_id uuid, p_report_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_report_image_upload(p_report_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_reports_authorized(p_organization_id uuid, p_report_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_generated_shift_atomic(p_shift_id uuid, p_org_id uuid, p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(p_organization_id uuid, p_report_id uuid, p_client_id uuid, p_shift_id uuid, p_segment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_values jsonb, p_session_id text, p_actual_service_type_id uuid, p_actual_staffs jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_atomic_v2(p_organization_id uuid, p_report_id uuid, p_client_id uuid, p_shift_id uuid, p_segment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_values jsonb, p_session_id text, p_actual_service_type_id uuid, p_actual_staffs jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_autosave_authorized(p_organization_id uuid, p_client_id uuid, p_report_id uuid, p_draft_key uuid, p_base_content_revision bigint, p_autosave_revision bigint, p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_report_versioned(p_organization_id uuid, p_report_id uuid, p_client_id uuid, p_shift_id uuid, p_segment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_status text, p_values jsonb, p_expected_version bigint, p_idempotency_key uuid, p_session_id text, p_actual_service_type_id uuid, p_actual_staffs jsonb, p_correction_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_shift_pattern_atomic(p_pattern_id uuid, p_org_id uuid, p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_organization(p_org_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_reports_authorized(p_organization_id uuid, p_report_ids uuid[], p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_shifts_atomic(p_org_id uuid, p_shift_ids uuid[], p_reason text, p_retention_until timestamp with time zone, p_sync_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_owner_atomic(p_org_id uuid, p_new_owner_id uuid, p_current_owner_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_reports_authorized(p_organization_id uuid, p_report_ids uuid[], p_transition text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_google_connection_health(p_org_id uuid, p_status text, p_error_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_setting(p_org_id uuid, p_setting text, p_value text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_client_form_authorized(p_organization_id uuid, p_client_id uuid, p_schema jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shift_assignments_atomic(p_org_id uuid, p_client_id uuid, p_staff_ids uuid[]) TO authenticated;

-- Invitation preview is the sole anonymous RPC. It accepts an unguessable
-- invitation code and returns only the bounded preview defined by the function.
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text) TO anon;


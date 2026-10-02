-- Extend existing short-lived, one-time grants without weakening their session binding.
ALTER TABLE public.reauth_grants DROP CONSTRAINT reauth_grants_purpose_check;
ALTER TABLE public.reauth_grants ADD CONSTRAINT reauth_grants_purpose_check CHECK (purpose IN (
  'owner_transfer', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete', 'account_password_reset'
));
ALTER TABLE public.stepup_reauth_challenges DROP CONSTRAINT stepup_reauth_challenges_purpose_check;
ALTER TABLE public.stepup_reauth_challenges ADD CONSTRAINT stepup_reauth_challenges_purpose_check CHECK (purpose IN (
  'owner_transfer', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete'
));

CREATE TABLE public.password_reset_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash text NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.password_reset_requests TO service_role;
REVOKE ALL ON SEQUENCE public.password_reset_requests_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.password_reset_requests_id_seq TO service_role;
CREATE INDEX password_reset_requests_email_idx ON public.password_reset_requests(email_hash, created_at);
CREATE INDEX password_reset_requests_ip_idx ON public.password_reset_requests(ip_hash, created_at);

CREATE FUNCTION public.reserve_password_reset_request(p_email_hash text, p_ip_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  p_ip_hash := NULLIF(p_ip_hash, '');
  IF p_email_hash IS NULL OR length(p_email_hash) <> 64 THEN RETURN false; END IF;
  -- Fixed ordering avoids deadlocks; serialization prevents concurrent requests
  -- from all passing the same pre-insert count. No account-directory lookup.
  IF p_ip_hash IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('reset-ip:' || p_ip_hash, 0)); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reset-email:' || p_email_hash, 0));
  IF EXISTS (SELECT 1 FROM public.password_reset_requests WHERE email_hash=p_email_hash AND created_at > now()-interval '60 seconds')
    OR (SELECT count(*) FROM public.password_reset_requests WHERE created_at > now()-interval '15 minutes'
        AND (email_hash=p_email_hash OR (p_ip_hash IS NOT NULL AND ip_hash=p_ip_hash))) >= 5 THEN
    RETURN false;
  END IF;
  INSERT INTO public.password_reset_requests(email_hash, ip_hash) VALUES(p_email_hash, p_ip_hash);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_password_reset_request(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_password_reset_request(text,text) TO service_role;

-- Retain the legacy signature for schema compatibility, but remove browser
-- execution: old clients must reload before requesting account deletion.
REVOKE ALL ON FUNCTION public.request_own_account_deletion(text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.request_own_account_deletion(p_retention_basis text, p_reauth_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_now timestamptz := now(); v_proof uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  UPDATE public.reauth_grants SET used_at=v_now
    WHERE token_hash=encode(extensions.digest(p_reauth_token, 'sha256'), 'hex')
      AND user_id=v_actor AND auth_session_id=(auth.jwt()->>'session_id')
      AND purpose='account_delete' AND used_at IS NULL AND expires_at>v_now
    RETURNING user_id INTO v_proof;
  IF v_proof IS NULL THEN RAISE EXCEPTION 'account_delete_requires_reauthentication'; END IF;
  INSERT INTO public.user_deletion_requests(user_id, retention_basis) VALUES(v_actor, p_retention_basis);
  UPDATE public.profiles SET deleted_at=v_now, deletion_reason='本人による退会申請', last_organization_id=NULL WHERE id=v_actor;
  UPDATE public.staffs SET user_id=NULL WHERE user_id=v_actor;
  DELETE FROM public.organization_members WHERE user_id=v_actor;
END $$;
REVOKE ALL ON FUNCTION public.request_own_account_deletion(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_own_account_deletion(text,text) TO authenticated;

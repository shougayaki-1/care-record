-- Infrastructure-only, cross-tenant COUNTS. No business permission or raw row access.
-- Provision a separate LOGIN member per environment outside migrations; no password here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'care_security_monitor') THEN
    CREATE ROLE care_security_monitor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA private TO care_security_monitor;

-- Derived operational state, not audit history. No tenant identifiers or event details.
CREATE TABLE private.security_monitor_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 32768)
);
ALTER TABLE private.security_monitor_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.security_monitor_state FROM PUBLIC, anon, authenticated, service_role, care_security_monitor;
INSERT INTO private.security_monitor_state(singleton) VALUES (true);

CREATE INDEX login_attempts_monitor_created_idx ON public.login_attempts(created_at);

CREATE FUNCTION private.security_monitor_snapshot() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 WITH bounds AS (
   SELECT now() AS observed_at,
     (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo') AS day_end
 ), recent AS MATERIALIZED (
   SELECT l.* FROM public.login_attempts l, bounds b
   WHERE l.created_at >= b.observed_at - interval '15 minutes' AND l.created_at < b.observed_at
 ), failures AS (
   SELECT * FROM recent WHERE outcome = 'failure'
 ), metrics AS (
   SELECT
     (SELECT count(*) FROM failures f, bounds b WHERE f.created_at >= b.observed_at - interval '5 minutes') AS failures_5m,
     (SELECT count(*) FROM failures) AS failures_15m,
     (SELECT count(*) FROM (SELECT ip_hash FROM failures WHERE ip_hash IS NOT NULL AND email_hash IS NOT NULL
       GROUP BY ip_hash HAVING count(DISTINCT email_hash) >= 5) g) AS spray_sources_15m,
     (SELECT count(*) FROM (SELECT email_hash FROM failures WHERE email_hash IS NOT NULL AND ip_hash IS NOT NULL
       GROUP BY email_hash HAVING count(DISTINCT ip_hash) >= 5) g) AS distributed_targets_15m,
     (SELECT count(*) FROM recent s WHERE s.outcome = 'success' AND s.email_hash IS NOT NULL
       AND (SELECT count(*) FROM failures f WHERE f.email_hash = s.email_hash AND f.created_at < s.created_at) >= 5) AS success_after_failures_15m,
     (SELECT count(*) FROM recent WHERE ip_hash IS NULL OR email_hash IS NULL) AS missing_hashes_15m,
     (SELECT count(*) FROM recent) AS attempts_15m,
     (SELECT count(*) FROM public.audit_events a, bounds b WHERE a.action_type = 'auth.login'
       AND a.created_at >= b.observed_at - interval '15 minutes' AND a.created_at < b.observed_at) AS audit_logins_15m
 ), daily AS (
   SELECT count(*) FILTER (WHERE l.outcome = 'failure') AS failures,
     count(*) FILTER (WHERE l.outcome = 'success') AS successes,
     count(*) FILTER (WHERE l.ip_hash IS NULL OR l.email_hash IS NULL) AS missing_hashes
   FROM public.login_attempts l, bounds b WHERE l.created_at >= b.day_end - interval '1 day' AND l.created_at < b.day_end
 ), important AS (
   SELECT count(*) AS events FROM public.audit_events a, bounds b
   WHERE a.created_at >= b.day_end - interval '1 day' AND a.created_at < b.day_end
     AND a.action_type IN ('organization.owner_add', 'organization.owner_transfer', 'organization.soft_delete',
       'role.create', 'role.update', 'role.delete', 'role.preset_reset', 'account.password_reset',
       'account.password_change', 'account.email_change_request', 'account.role_update', 'account.roles_update',
       'account.remove', 'account.self_delete_request')
 )
 SELECT jsonb_build_object('observed_at', b.observed_at, 'day_start', b.day_end - interval '1 day', 'day_end', b.day_end,
   'metrics', to_jsonb(m), 'daily', to_jsonb(d) || jsonb_build_object('important_events', i.events),
   'version', s.version, 'state', s.state)
 FROM bounds b CROSS JOIN metrics m CROSS JOIN daily d CROSS JOIN important i CROSS JOIN private.security_monitor_state s;
$$;

-- CAS prevents a second operator/process from silently overwriting delivery acknowledgements.
CREATE FUNCTION private.security_monitor_save(p_version bigint, p_state jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v bigint;
BEGIN
  UPDATE private.security_monitor_state SET state = p_state, version = version + 1
    WHERE singleton AND version = p_version RETURNING version INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'security_monitor_state_conflict'; END IF;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION private.security_monitor_snapshot(), private.security_monitor_save(bigint,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.security_monitor_snapshot(), private.security_monitor_save(bigint,jsonb)
  TO care_security_monitor;

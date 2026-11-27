-- #151: operator-run migration, deliberately outside automatic migration up.
-- Run only AFTER A/B deployment, old-job drain and environment-specific approval.
-- See docs/audit-cutover-runbook.md. Missing approval inputs fail closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.audit_events IN ACCESS EXCLUSIVE MODE;

DO $cutover$
DECLARE
  cutover uuid := nullif(current_setting('care_record.audit_cutover_id', true), '')::uuid;
  evidence text := current_setting('care_record.audit_cutover_evidence', true);
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed'
     OR cutover IS NULL OR evidence IS NULL OR evidence !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'audit_cutover_approval_required';
  END IF;
  IF to_regprocedure('public.begin_audit_archive(jsonb,boolean)') IS NULL
     OR to_regprocedure('public.read_audit_archive(uuid,jsonb)') IS NULL
     OR to_regprocedure('private.chain_audit_event_v2()') IS NULL
     OR to_regclass('private.audit_archive_items') IS NULL
     OR to_regclass('private.audit_chain_heads') IS NULL THEN
    RAISE EXCEPTION 'audit_cutover_dependencies_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_events'::regclass
      AND tgname='audit_events_chain_insert' AND tgfoid='private.chain_audit_event()'::regprocedure
      AND tgenabled='O')
     OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum
       WHERE a.attrelid='public.audit_events'::regclass AND a.attname='integrity_version'
       AND pg_get_expr(d.adbin,d.adrelid)='1')
     OR EXISTS (SELECT 1 FROM private.audit_chain_heads)
     OR EXISTS (SELECT 1 FROM public.audit_events WHERE integrity_version IS DISTINCT FROM 1) THEN
    RAISE EXCEPTION 'audit_cutover_unexpected_state';
  END IF;
  -- A singleton prevents any retry/reset from adopting another GENESIS. Record
  -- only the boundary, not a verdict or a replacement for external receipts.
  CREATE TABLE private.audit_cutover_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    cutover_id uuid NOT NULL,
    evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
    boundary_at timestamptz NOT NULL,
    v1_count bigint NOT NULL CHECK (v1_count >= 0)
  );
  ALTER TABLE private.audit_cutover_state ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON private.audit_cutover_state FROM PUBLIC, anon, authenticated, service_role;
  CREATE TRIGGER audit_cutover_no_mutation BEFORE UPDATE OR DELETE ON private.audit_cutover_state
    FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();
  INSERT INTO private.audit_cutover_state
    SELECT true, cutover, evidence, clock_timestamp(), count(*) FROM public.audit_events;
  DROP TRIGGER audit_events_chain_insert ON public.audit_events;
  EXECUTE format('CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events
    FOR EACH ROW EXECUTE FUNCTION private.chain_audit_event_v2(%L)', cutover::text);
  ALTER TABLE public.audit_events ALTER COLUMN integrity_version SET DEFAULT 2;
END;
$cutover$;
COMMIT;

-- 運用証跡。本文に医療情報を入れず、原本参照・ハッシュ・承認を保持する。
CREATE TABLE IF NOT EXISTS public.compliance_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), control_id text NOT NULL,
  evidence_type text NOT NULL, artifact_uri text NOT NULL, artifact_sha256 text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(), valid_until timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, notes text
);

CREATE TABLE IF NOT EXISTS public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL CHECK(severity IN('critical','high','medium','low')),
  status text NOT NULL CHECK(status IN('open','contained','recovered','closed')),
  detected_at timestamptz NOT NULL, contained_at timestamptz, closed_at timestamptz,
  summary text NOT NULL, personal_data_impact text, regulator_reference text,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.backup_restore_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), performed_at timestamptz NOT NULL,
  environment text NOT NULL, backup_reference text NOT NULL, expected_rpo_minutes integer NOT NULL,
  achieved_rpo_minutes integer, expected_rto_minutes integer NOT NULL, achieved_rto_minutes integer,
  integrity_verified boolean NOT NULL DEFAULT false, result text NOT NULL CHECK(result IN('pass','fail')),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, notes text
);

CREATE TABLE IF NOT EXISTS public.vendor_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_name text NOT NULL UNIQUE,
  service_name text NOT NULL, data_categories text[] NOT NULL DEFAULT '{}', processing_countries text[] NOT NULL DEFAULT '{}',
  subprocessors_uri text, security_assessment_uri text, contract_reviewed_at timestamptz,
  next_review_at timestamptz, exit_plan text NOT NULL, approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.compliance_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), risk_key text NOT NULL UNIQUE, description text NOT NULL,
  likelihood smallint NOT NULL CHECK(likelihood BETWEEN 1 AND 5), impact smallint NOT NULL CHECK(impact BETWEEN 1 AND 5),
  treatment text NOT NULL, status text NOT NULL CHECK(status IN('open','mitigating','accepted','closed')),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, due_at timestamptz,
  accepted_until timestamptz, approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.compliance_risks(risk_key,description,likelihood,impact,treatment,status,due_at,accepted_until)
VALUES('AUTH-2FA-EXEMPT','二要素認証を今回の準拠化対象から一時的に除外',3,5,
       '短時間セッション、レート制限、操作監査による代替策。期限到来時に再評価','accepted',
       now()+interval '180 days',now()+interval '180 days')
ON CONFLICT(risk_key) DO NOTHING;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_evidence','security_incidents','backup_restore_tests','vendor_registry','compliance_risks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_archive_checkpoints (
  destination text PRIMARY KEY, last_created_at timestamptz, last_event_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_archive_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_archive_checkpoints FROM anon,authenticated;

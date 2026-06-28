-- サービス種別マスタ（事業所ごとにカスタマイズ可能）
CREATE TABLE public.service_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX ON public.service_types (organization_id, sort_order);

ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read service types" ON public.service_types
  FOR SELECT USING (
    private.is_org_member(organization_id)
    AND deleted_at IS NULL
  );

REVOKE INSERT, UPDATE, DELETE ON public.service_types FROM authenticated;

-- スタッフ役割マスタ（事業所ごとにカスタマイズ可能）
CREATE TABLE public.staff_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  is_unpaid        boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX ON public.staff_roles (organization_id, sort_order);

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read staff roles" ON public.staff_roles
  FOR SELECT USING (
    private.is_org_member(organization_id)
    AND deleted_at IS NULL
  );

REVOKE INSERT, UPDATE, DELETE ON public.staff_roles FROM authenticated;

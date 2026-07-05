-- supabase/migrations/20260705000000_offices.sql

CREATE TABLE IF NOT EXISTS "public"."offices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "travel_cost_rate_yen_per_km" numeric(8,2) DEFAULT 20 NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "offices_travel_cost_rate_yen_per_km_check"
        CHECK ((("travel_cost_rate_yen_per_km" >= (0)::numeric) AND ("travel_cost_rate_yen_per_km" <= (10000)::numeric)))
);

ALTER TABLE "public"."offices" OWNER TO "postgres";

ALTER TABLE ONLY "public"."offices"
    ADD CONSTRAINT "offices_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."offices"
    ADD CONSTRAINT "offices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE "public"."offices" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read offices" ON "public"."offices"
    FOR SELECT TO "authenticated"
    USING (("private"."is_org_member"("organization_id") AND ("archived_at" IS NULL)));

GRANT SELECT ON TABLE "public"."offices" TO "authenticated";
GRANT ALL ON TABLE "public"."offices" TO "service_role";

-- 利用者・スタッフの所属事業所（タグ）。権限境界ではなく交通費単価の参照先として使う。
ALTER TABLE "public"."clients" ADD COLUMN "office_id" "uuid";
ALTER TABLE "public"."staffs" ADD COLUMN "office_id" "uuid";

ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."staffs"
    ADD CONSTRAINT "staffs_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE RESTRICT;

-- バックフィル: 各organizationに現行の交通費単価を引き継いだデフォルト事業所を1件作成し、
-- 既存の全client/staffをそこに割り当てる。
DO $$
DECLARE
    org RECORD;
    new_office_id uuid;
BEGIN
    FOR org IN SELECT "id", "name", "travel_cost_rate_yen_per_km" FROM "public"."organizations" WHERE "deleted_at" IS NULL LOOP
        INSERT INTO "public"."offices" ("organization_id", "name", "travel_cost_rate_yen_per_km")
        VALUES (org."id", org."name", org."travel_cost_rate_yen_per_km")
        RETURNING "id" INTO new_office_id;

        UPDATE "public"."clients" SET "office_id" = new_office_id
        WHERE "organization_id" = org."id" AND "office_id" IS NULL;

        UPDATE "public"."staffs" SET "office_id" = new_office_id
        WHERE "organization_id" = org."id" AND "office_id" IS NULL;
    END LOOP;
END $$;

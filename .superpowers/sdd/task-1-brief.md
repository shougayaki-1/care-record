### Task 1: `offices` テーブルのマイグレーション

**Files:**
- Create: `supabase/migrations/20260705000000_offices.sql`

**Interfaces:**
- Produces: テーブル `public.offices(id uuid, organization_id uuid, name text, travel_cost_rate_yen_per_km numeric(8,2), archived_at timestamptz, created_at timestamptz, updated_at timestamptz)`。カラム `public.clients.office_id uuid`、`public.staffs.office_id uuid`（共に `offices(id)` を参照、`ON DELETE RESTRICT`）。RLSポリシー `"Org members read offices"`（SELECT、`is_org_member(organization_id) AND archived_at IS NULL`）。

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
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
```

- [ ] **Step 2: ローカルSupabaseに適用する**

Run: `supabase migration up`
Expected: マイグレーションが `Applying migration 20260705000000_offices.sql...` のように出力され、エラーなく完了する。

- [ ] **Step 3: バックフィルを確認する**

Run: `supabase db execute --sql "select count(*) from offices; select count(*) from staffs where office_id is null; select count(*) from clients where office_id is null;"` （ローカルSupabaseに既存の組織・スタッフ・利用者データがある場合）
Expected: `offices` の件数が organizations の件数と一致し、`office_id is null` の件数がどちらも0。

- [ ] **Step 4: `supabase/tests/security_hardening.test.sql` の更新要否を確認する**

`supabase/tests/security_hardening.test.sql` を読み、`offices` テーブルの読み取りRLS（組織外ユーザーから見えないこと）を検証するテストケースの追加が既存パターンに沿って必要か判断する。既存ファイルの他テーブルの検証パターン（例: `staff_roles` があれば流用）に倣って同等のケースを追加する。

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/20260705000000_offices.sql supabase/tests/security_hardening.test.sql
git commit -m "feat: add offices table with per-office travel cost rate and client/staff office_id"
```

---


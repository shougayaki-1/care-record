# シフト連動型記録権限修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「シフトに入っているスタッフは記録を書けるべき」という業務の現実にシステムを合わせ、設定漏れを防ぐUIを追加する。

**Architecture:** 3 方針を並行実施。方針S: DB関数の権限判定にシフト存在チェックを OR 条件で追加（新規マイグレーション）。方針A: シフト/ひな形作成時に `assignments` テーブルへ自動登録するオプション（サーバーアクション + UI チェックボックス）。方針B: 利用者一覧に担当者数列を追加し設定漏れを可視化。

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), TypeScript, MUI

## Global Constraints

- Supabase Admin クライアント (`supabaseAdmin`) を使う Server Actions では RLS をバイパスするため、必ず手動で組織メンバーシップ検証を行う
- DB 関数は `SECURITY DEFINER` / `SET search_path = ''` または `= private, public` を維持する
- マイグレーションファイル名は `202606280005_shift_based_record_access.sql`（現在の最新は `202606280004`）
- SQL 関数の GRANT/REVOKE は既存の形式に従う
- TypeScript の型変更は既存の `ShiftPayload` / `ShiftPatternPayload` 型に `autoAssign?: boolean` を追記する形にし、既存呼び出し元を壊さない

---

### Task 1: DB マイグレーション — シフト連動記録権限（方針S）

**Files:**
- Create: `supabase/migrations/202606280005_shift_based_record_access.sql`

**Interfaces:**
- Produces: 更新済み `private.can_access_client(uuid)` 関数・更新済み `public.save_report_atomic(...)` 関数
- Consumes: 既存 `private.is_assigned_client_for_user`, `private.get_actor_staff_id`, `private.get_member_record_action_scope`

- [ ] **Step 1: マイグレーションファイルを作成する**

`supabase/migrations/202606280005_shift_based_record_access.sql` を以下の内容で作成する。

```sql
-- 方針S: 「シフトに入っているスタッフは記録を読み書きできる」権限拡張
--
-- 変更点1: can_access_client — assignments OR shift_staffs の OR 条件に拡張
-- 変更点2: save_report_atomic — 新規作成・編集両方で同じ OR 条件に拡張

-- ──────────────────────────────────────────────────────────────────────────
-- 1. can_access_client の更新
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.can_access_client(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
STABLE
AS $$
  WITH
    client_org AS (
      SELECT c.organization_id
      FROM public.clients c
      WHERE c.id = p_client_id
        AND c.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = c.organization_id
            AND om.user_id = auth.uid()
        )
    ),
    scope AS (
      SELECT
        private.get_member_record_view_scope(co.organization_id, auth.uid()) AS s,
        co.organization_id
      FROM client_org co
    )
  SELECT EXISTS (
    SELECT 1 FROM scope
    WHERE scope.s = 'all'
      OR (
        scope.s = 'assigned'
        AND (
          -- 従来条件: assignments テーブルに登録済み（helper_id or staff_id）
          private.is_assigned_client_for_user(p_client_id, scope.organization_id, auth.uid())
          -- 追加条件: 当該利用者の shift_staffs に自分の staff_id が入っている
          OR EXISTS (
            SELECT 1
            FROM public.shifts s
            JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = scope.organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = private.get_actor_staff_id(scope.organization_id, auth.uid())
          )
        )
      )
  )
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. save_report_atomic の更新
--    変更箇所: 新規作成時の access_denied チェック（1 箇所）
--             編集時の access_denied チェック（1 箇所）
--    それ以外のロジックは 202606270004 から変更なし
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_report_atomic(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_values jsonb,
  p_session_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid := p_report_id;
  previous_status text;
  existing_helper uuid;
  existing_shift_id uuid;
  effective_shift_id uuid := p_shift_id;
  actor_staff_id uuid;
  create_scope text;
  edit_scope text;
  approve_scope text;
  required_scope text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF p_end_at <= p_start_at THEN RAISE EXCEPTION 'invalid_period'; END IF;
  IF p_status NOT IN ('draft', 'pending', 'approved', 'remanded') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF octet_length(p_values::text) > 1000000 THEN RAISE EXCEPTION 'values_too_large'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = p_organization_id
       AND om.user_id = actor
  ) THEN RAISE EXCEPTION 'access_denied'; END IF;

  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'create') INTO create_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'edit') INTO edit_scope;
  SELECT private.get_member_record_action_scope(p_organization_id, actor, 'approve') INTO approve_scope;

  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'client_not_found'; END IF;

  SELECT st.id INTO actor_staff_id
    FROM public.staffs st
   WHERE st.organization_id = p_organization_id
     AND st.user_id = actor
     AND st.deleted_at IS NULL
   ORDER BY st.sort_order NULLS LAST, st.name
   LIMIT 1;

  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
     WHERE s.id = p_shift_id
       AND s.organization_id = p_organization_id
       AND s.client_id = p_client_id
       AND s.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'shift_not_found'; END IF;

  PERFORM set_config('care_record.skip_version', 'on', true);
  IF target IS NULL THEN
    -- ── 新規作成パス ────────────────────────────────────────────────────
    IF p_status IN ('approved', 'remanded') THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
    required_scope := create_scope;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    -- 権限チェック: assignments に登録済み OR 当該利用者のシフト（shift_staffs）に自分が入っている
    IF required_scope = 'assigned'
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = actor_staff_id
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    IF effective_shift_id IS NULL AND actor_staff_id IS NOT NULL THEN
      SELECT s.id INTO effective_shift_id
        FROM public.shifts s
       WHERE s.organization_id = p_organization_id
         AND s.client_id = p_client_id
         AND s.status <> 'cancelled'
         AND s.deleted_at IS NULL
         AND s.start_at < p_end_at
         AND s.end_at > p_start_at
         AND EXISTS (
           SELECT 1 FROM public.shift_staffs ss
            WHERE ss.shift_id = s.id
              AND ss.staff_id = actor_staff_id
         )
       ORDER BY
         abs(extract(epoch FROM (s.start_at - p_start_at))) + abs(extract(epoch FROM (s.end_at - p_end_at))),
         s.start_at
       LIMIT 1;
    END IF;

    IF effective_shift_id IS NULL THEN
      WITH candidates AS (
        SELECT s.id
          FROM public.shifts s
         WHERE s.organization_id = p_organization_id
           AND s.client_id = p_client_id
           AND s.status <> 'cancelled'
           AND s.deleted_at IS NULL
           AND s.start_at < p_end_at
           AND s.end_at > p_start_at
      )
      SELECT CASE WHEN count(*) = 1 THEN min(id) ELSE NULL END
        INTO effective_shift_id
        FROM candidates;
    END IF;

    INSERT INTO public.reports(client_id, helper_id, start_at, end_at, status, shift_id, updated_at)
    VALUES (p_client_id, actor, p_start_at, p_end_at, p_status, effective_shift_id, now()) RETURNING id INTO target;
    INSERT INTO public.report_values(report_id, data) VALUES(target, p_values);
  ELSE
    -- ── 編集パス ────────────────────────────────────────────────────────
    SELECT r.status, r.helper_id, r.shift_id INTO previous_status, existing_helper, existing_shift_id
      FROM public.reports r JOIN public.clients c ON c.id = r.client_id
     WHERE r.id = target AND r.client_id = p_client_id AND c.organization_id = p_organization_id
       AND r.deleted_at IS NULL FOR UPDATE;
    IF previous_status IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;
    IF previous_status = 'approved' AND p_status <> 'remanded' THEN RAISE EXCEPTION 'approved_report_locked'; END IF;

    required_scope := CASE WHEN p_status IN ('approved', 'remanded') THEN approve_scope ELSE edit_scope END;
    IF required_scope = 'none' THEN RAISE EXCEPTION 'access_denied'; END IF;

    -- 権限チェック: 自分が作成者 OR assignments に登録済み OR シフト（shift_staffs）に自分が入っている
    IF required_scope = 'assigned'
       AND existing_helper IS DISTINCT FROM actor
       AND NOT EXISTS (
         SELECT 1 FROM public.assignments a
          WHERE a.client_id = p_client_id
            AND (a.helper_id = actor OR (actor_staff_id IS NOT NULL AND a.staff_id = actor_staff_id))
       )
       AND NOT (
         actor_staff_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.shifts s
           JOIN public.shift_staffs ss ON ss.shift_id = s.id
            WHERE s.client_id = p_client_id
              AND s.organization_id = p_organization_id
              AND s.deleted_at IS NULL
              AND ss.staff_id = actor_staff_id
         )
       )
    THEN RAISE EXCEPTION 'access_denied'; END IF;

    effective_shift_id := COALESCE(p_shift_id, existing_shift_id);
    IF effective_shift_id IS NULL THEN
      SELECT rs.shift_id INTO effective_shift_id
        FROM public.report_shifts rs
       WHERE rs.report_id = target
         AND rs.is_primary = true
       ORDER BY rs.created_at
       LIMIT 1;
    END IF;

    UPDATE public.reports SET start_at=p_start_at, end_at=p_end_at, status=p_status,
      shift_id=effective_shift_id, updated_at=now(),
      approved_by=CASE WHEN p_status='approved' THEN actor WHEN p_status='remanded' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN p_status='approved' THEN now() WHEN p_status='remanded' THEN NULL ELSE approved_at END
     WHERE id=target;
    IF EXISTS (SELECT 1 FROM public.report_values rv WHERE rv.report_id=target) THEN
      UPDATE public.report_values SET data=p_values WHERE report_id=target;
    ELSE
      INSERT INTO public.report_values(report_id,data) VALUES(target,p_values);
    END IF;
  END IF;

  IF effective_shift_id IS NOT NULL THEN
    UPDATE public.report_shifts
       SET is_primary = false
     WHERE report_id = target
       AND is_primary = true
       AND shift_id <> effective_shift_id;

    INSERT INTO public.report_shifts(report_id, shift_id, is_primary)
    VALUES (target, effective_shift_id, true)
    ON CONFLICT (report_id, shift_id)
    DO UPDATE SET is_primary = true;
  END IF;

  PERFORM private.capture_complete_report_version(target, actor, CASE WHEN p_report_id IS NULL THEN 'create' ELSE 'update:'||p_status END, p_session_id);
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
  VALUES(p_organization_id,actor,CASE WHEN p_report_id IS NULL THEN 'report.create' ELSE 'report.'||p_status END,
    'report',target::text,'success',p_session_id,jsonb_build_object('previousStatus',previous_status,'newStatus',p_status,'shiftId',effective_shift_id));
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text) TO authenticated;
```

- [ ] **Step 2: ローカル Supabase DB に適用して確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
supabase db reset --local 2>&1 | tail -20
```

期待: エラーなし。`Applied migration 202606280005_shift_based_record_access` が表示される。

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/202606280005_shift_based_record_access.sql
git commit -m "feat(db): extend record access to shift-based staff (方針S)

- can_access_client: assignments OR shift_staffs の OR 条件に拡張
- save_report_atomic: 新規作成・編集双方で同様の OR 条件を追加
シフトにアサインされているスタッフが assignments 未登録でも記録を読み書きできるようになる。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Server Action — シフト作成時の自動アサイン（方針A バックエンド）

**Files:**
- Modify: `src/app/actions/shift.ts`

**Interfaces:**
- Produces: `ShiftPayload.autoAssign?: boolean` フィールド、`ShiftPatternPayload.autoAssign?: boolean` フィールド
- `createShift()` が `autoAssign=true` のとき `assignments` に upsert する

- [ ] **Step 1: `ShiftPayload` と `ShiftPatternPayload` に `autoAssign` を追加し、`createShift` にロジックを追加する**

`src/app/actions/shift.ts` の `ShiftPayload` 型定義（59行目付近）を修正:

```typescript
export type ShiftPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startAt: string;
    endAt: string;
    staffIds: string[];
    status?: 'published' | 'cancelled';
    cancelReason?: string;
    patternId?: string;
    isModified?: boolean;
    autoAssign?: boolean;  // ← 追加
};
```

`src/app/actions/shift.ts` の `ShiftPatternPayload` 型定義（72行目付近）を修正:

```typescript
export type ShiftPatternPayload = {
    organizationId: string;
    clientId: string;
    title: string;
    startTime: string;
    endTime: string;
    rrule: string;
    staffIds: string[];
    autoAssign?: boolean;  // ← 追加
};
```

`createShift` 関数（597行目付近）の末尾に自動アサイン処理を追加:

```typescript
export async function createShift(payload: ShiftPayload, awaitSync: boolean | 'skip' = true) {
    const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
    const result = await createShiftInternal(payload, awaitSync);
    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift.create', resourceType: 'shift', resourceId: result.shiftId });

    // 自動アサイン: シフト作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
    if (payload.autoAssign && payload.staffIds.length > 0) {
        await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, payload.staffIds);
    }

    return result;
}
```

`createShiftPattern` 関数（831行目付近）にも自動アサインを追加:

```typescript
export async function createShiftPattern(payload: ShiftPatternPayload) {
    const actor = await assertShiftPermission(payload.organizationId, 'create', { clientId: payload.clientId });
    const { data: pattern, error } = await supabaseAdmin.from('shift_patterns').insert({
        organization_id: payload.organizationId, client_id: payload.clientId, title: payload.title,
        start_time: payload.startTime, end_time: payload.endTime, rrule: payload.rrule
    }).select('id').single();
    if (error || !pattern) throw error;

    if (payload.staffIds.length > 0) {
        const inserts: PatternStaffInsert[] = payload.staffIds.map(sid => ({ pattern_id: pattern.id, staff_id: sid }));
        await supabaseAdmin.from('shift_pattern_staffs').insert(inserts);
    }

    // 自動アサイン: ひな形作成時に選択スタッフを assignments に登録（チェックボックス ON 時のみ）
    if (payload.autoAssign && payload.staffIds.length > 0) {
        await upsertAssignmentsForStaffs(payload.organizationId, payload.clientId, payload.staffIds);
    }

    await recordAuditEvent({ organizationId: payload.organizationId, actorId: actor.userId, action: 'shift_pattern.create', resourceType: 'shift_pattern', resourceId: pattern.id });
    return { success: true };
}
```

`src/app/actions/shift.ts` の `type ShiftStaffInsert` 定義直前（82行目付近）に `upsertAssignmentsForStaffs` ヘルパーを追加:

```typescript
/** 指定スタッフを利用者の担当者として upsert する（既存エントリは変更しない） */
async function upsertAssignmentsForStaffs(organizationId: string, clientId: string, staffIds: string[]) {
    const { data: staffRows } = await supabaseAdmin
        .from('staffs')
        .select('id, user_id')
        .eq('organization_id', organizationId)
        .in('id', staffIds)
        .is('deleted_at', null);
    if (!staffRows || staffRows.length === 0) return;
    await supabaseAdmin.from('assignments').upsert(
        staffRows.map(s => ({
            client_id: clientId,
            staff_id: s.id,
            helper_id: s.user_id ?? null,
        })),
        { onConflict: 'client_id,staff_id', ignoreDuplicates: true }
    );
}
```

- [ ] **Step 2: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/app/actions/shift.ts
git commit -m "feat(actions): add autoAssign option to createShift and createShiftPattern (方針A)

シフト作成・ひな形作成時に autoAssign=true を渡すと、
選択スタッフを assignments テーブルにも自動登録する。
既存エントリは更新しない（ignoreDuplicates）。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: UI — ShiftFormModal に自動アサインチェックボックスを追加（方針A フロントエンド）

**Files:**
- Modify: `src/components/shifts/ShiftFormModal.tsx`

**Interfaces:**
- Consumes: `ShiftPayload.autoAssign?: boolean`（Task 2 で追加）
- `onSave(payload: ShiftPayload, shiftId?: string)` に `autoAssign` を含む payload を渡す

- [ ] **Step 1: ShiftFormModal に autoAssign state とチェックボックス UI を追加する**

`src/components/shifts/ShiftFormModal.tsx` を以下のように修正する。

インポートに `FormControlLabel, Checkbox` を追加（既存の mui import に追記）:

```typescript
import {
    Button, Stack,
    Box, Typography,
    IconButton, Tooltip, Divider,
    FormControlLabel, Checkbox     // ← 追加
} from '@/components/ui/mui';
```

`useState` の並びに `autoAssign` state を追加（53行目付近）:

```typescript
    const [cancelReason, setCancelReason] = useState('');
    const [autoAssign, setAutoAssign] = useState(true);   // ← 追加
```

`useEffect` の else ブランチ（新規作成リセット部分）に reset を追加（75行目付近）:

```typescript
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartAt('');
                setEndAt('');
                setCancelReason('');
                setAutoAssign(true);   // ← 追加
            }
```

`handleSave` の payload 組み立て部分に `autoAssign` を追加（90行目付近）:

```typescript
            const payload: ShiftPayload = {
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startAt: new Date(startAt).toISOString(),
                endAt: new Date(endAt).toISOString(),
                staffIds: selectedStaffIds,
                isModified: true,
                autoAssign: !initialData ? autoAssign : false,   // ← 追加（新規作成時のみ有効）
            };
```

JSX の日時フィールドの直後（DateTimeField Stack の後、`{initialData && ...}` の前）にチェックボックスを追加:

```tsx
                    {/* 新規作成時のみ: 自動アサインチェックボックス */}
                    {!initialData && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={autoAssign}
                                    onChange={(e) => setAutoAssign(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2" color="text.secondary">
                                    選択したスタッフを基本担当（担当スタッフ設定）にも登録する
                                </Typography>
                            }
                        />
                    )}
```

- [ ] **Step 2: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/shifts/ShiftFormModal.tsx
git commit -m "feat(ui): add auto-assign checkbox to ShiftFormModal (方針A)

シフト新規作成時に「選択したスタッフを基本担当にも登録する」チェックボックスを追加。
デフォルト ON。既存シフト編集時は非表示。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: UI — ShiftPatternModal に自動アサインチェックボックスを追加（方針A ひな形）

**Files:**
- Modify: `src/components/shifts/ShiftPatternModal.tsx`

**Interfaces:**
- Consumes: `ShiftPatternPayload.autoAssign?: boolean`（Task 2 で追加）
- `onSave(payload: ShiftPatternPayload, patternId?: string)` に `autoAssign` を含む payload を渡す

- [ ] **Step 1: ShiftPatternModal に autoAssign state とチェックボックス UI を追加する**

`src/components/shifts/ShiftPatternModal.tsx` を以下のように修正する。

インポートに `FormControlLabel, Checkbox` を追加（既存の mui import に追記）:

```typescript
import {
    Stack, FormControl,
    Select, MenuItem, Box, Typography, Checkbox, FormGroup,
    FormControlLabel
} from '@/components/ui/mui';
```

（すでに `Checkbox` と `FormControlLabel` がインポートされているので変更不要の場合はスキップ）

`useState` の並びに `autoAssign` state を追加（83行目付近）:

```typescript
    const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
    const [autoAssign, setAutoAssign] = useState(true);   // ← 追加
```

`useEffect` の else ブランチ（新規作成リセット部分）に reset を追加（113行目付近）:

```typescript
            } else {
                setClientId('');
                setSelectedStaffIds([]);
                setStartTime('10:00');
                setEndTime('12:00');
                setFreq('WEEKLY');
                setIntervalCount(1);
                setSelectedDays([]);
                setSelectedWeeks([]);
                setAutoAssign(true);   // ← 追加
            }
```

`handleSave` の `onSave` 呼び出し部分に `autoAssign` を追加（142行目付近）:

```typescript
            await onSave({
                organizationId,
                clientId,
                title: `${clientName} (${staffNames})`,
                startTime: startTime.length === 5 ? `${startTime}:00` : startTime,
                endTime: endTime.length === 5 ? `${endTime}:00` : endTime,
                rrule: rruleStr,
                staffIds: selectedStaffIds,
                autoAssign: !initialData ? autoAssign : false,  // ← 追加（新規作成時のみ）
            }, initialData?.id);
```

JSX の `MultiSelectField` の直後（繰り返しスケジュール Box の前）にチェックボックスを追加:

```tsx
                    {/* 新規作成時のみ: 自動アサインチェックボックス */}
                    {!initialData && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={autoAssign}
                                    onChange={(e) => setAutoAssign(e.target.checked)}
                                    size="small"
                                />
                            }
                            label={
                                <Typography variant="body2" color="text.secondary">
                                    選択したスタッフを基本担当（担当スタッフ設定）にも登録する
                                </Typography>
                            }
                        />
                    )}
```

- [ ] **Step 2: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/shifts/ShiftPatternModal.tsx
git commit -m "feat(ui): add auto-assign checkbox to ShiftPatternModal (方針A)

ひな形新規作成時に「選択したスタッフを基本担当にも登録する」チェックボックスを追加。
デフォルト ON。既存ひな形編集時は非表示。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: UI — 利用者一覧に担当者数列を追加（方針B）

**Files:**
- Modify: `src/app/app/clients/page.tsx`

**Interfaces:**
- Consumes: Supabase `clients` テーブルと `assignments` テーブル（embedded select）
- Produces: `Client.assignments` フィールドに `{ staff_id: string }[]` が入る

- [ ] **Step 1: Client 型と fetchClients クエリを更新する**

`src/app/app/clients/page.tsx` の `Client` 型定義（20行目付近）を修正:

```typescript
type Client = { 
    id: string; 
    name: string; 
    created_at: string; 
    archived_at: string | null;
    assignments: { staff_id: string }[];   // ← 追加
};
```

`fetchClients` 内の `select('*')` を修正（49行目付近）:

```typescript
      let query = supabase
        .from('clients')
        .select('id, name, created_at, archived_at, assignments(staff_id)')
        .eq('organization_id', currentOrg.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
```

- [ ] **Step 2: DataTable に「担当者数」列を追加する**

`columns` 配列の `'status'` と `'actions'` の間に新しい列を追加（183行目付近）:

```typescript
          columns={[
            { key: 'name', header: '利用者氏名', render: (client) => client.name },
            { key: 'status', header: '状態', render: (client) => client.archived_at ? <StatusChip label="アーカイブ" /> : <StatusChip label="有効" tone="success" /> },
            { key: 'assignments', header: '担当者数', render: (client) =>
                client.assignments.length === 0
                  ? <StatusChip label="⚠️ 担当未設定" tone="warning" />
                  : <>{client.assignments.length}名</>
            },
            { key: 'actions', header: '操作', align: 'right', render: (client) => (
                // ... 既存の操作列（変更なし）
            )},
          ]}
```

- [ ] **Step 3: モバイルカードにも担当者数を追加する**

`mobileCardRender` 内の `StatusChip`（162行目付近）の下に追加:

```tsx
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                    {client.assignments.length === 0
                      ? <StatusChip label="⚠️ 担当未設定" tone="warning" />
                      : <Typography variant="caption" color="text.secondary">担当者 {client.assignments.length}名</Typography>
                    }
                  </Box>
```

- [ ] **Step 4: TypeScript コンパイルエラーがないことを確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -20
```

期待: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/app/clients/page.tsx
git commit -m "feat(ui): show assignment count in clients list with warning for unassigned (方針B)

利用者一覧に「担当者数」列を追加。担当者が0名の場合はオレンジ色の警告チップを表示し、
設定漏れを一目で確認できるようにする。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage

| 仕様 | 対応タスク |
|---|---|
| `can_access_client` に shift_staffs OR 条件追加 | Task 1 |
| `save_report_atomic` 新規作成パスに shift_staffs OR 条件追加 | Task 1 |
| `save_report_atomic` 編集パスに shift_staffs OR 条件追加 | Task 1 |
| シフト作成モーダルに自動アサインチェックボックス（デフォルトON） | Task 3 |
| ひな形作成モーダルに自動アサインチェックボックス（デフォルトON） | Task 4 |
| `assignments` テーブルへの upsert（サーバーアクション） | Task 2 |
| 利用者一覧に「担当者数」列 | Task 5 |
| 0名の場合はオレンジ色の警告チップ | Task 5 |

### Placeholder scan

プレースホルダーなし。全ステップに具体的なコードを記載済み。

### Type consistency

- `ShiftPayload.autoAssign?: boolean` — Task 2 で型定義に追加し、Task 3 の modal で参照
- `ShiftPatternPayload.autoAssign?: boolean` — Task 2 で型定義に追加し、Task 4 の modal で参照
- `Client.assignments: { staff_id: string }[]` — Task 5 で型定義に追加し、同タスク内で `client.assignments.length` を参照
- `upsertAssignmentsForStaffs(organizationId, clientId, staffIds)` — Task 2 で定義し、`createShift`・`createShiftPattern` から呼び出し

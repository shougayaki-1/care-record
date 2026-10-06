BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

SELECT ok(NOT has_function_privilege('authenticated', 'public.create_notification(uuid,text,uuid,uuid,uuid,uuid)', 'EXECUTE'), 'clients cannot create arbitrary notifications');
SELECT ok(NOT has_function_privilege('anon', 'public.create_notification(uuid,text,uuid,uuid,uuid,uuid)', 'EXECUTE'), 'anonymous cannot create notifications');
SELECT ok(NOT has_function_privilege('authenticated', 'private.create_notification(uuid,uuid,text,uuid,uuid,uuid)', 'EXECUTE'), 'internal helper is unavailable to clients');
SELECT ok(NOT has_table_privilege('authenticated', 'public.notifications', 'INSERT'), 'clients cannot bypass templates by inserting directly');
SELECT ok(NOT has_column_privilege('authenticated', 'public.notifications', 'content', 'UPDATE'), 'clients cannot edit notification text');
SELECT ok(NOT has_column_privilege('authenticated', 'public.notifications', 'user_id', 'UPDATE'), 'clients cannot transfer notification ownership');
SELECT ok(NOT has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'), 'clients cannot forge read timestamps');
SELECT ok(has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE'), 'legacy read-state update remains available');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) VALUES
  ('59000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notification-one@example.invalid', 'x', now(), now(), now()),
  ('59000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notification-two@example.invalid', 'x', now(), now(), now());
INSERT INTO public.organizations (id, name) VALUES
  ('59000000-0000-4000-8000-000000000010', 'Notification fixture one'),
  ('59000000-0000-4000-8000-000000000020', 'Notification fixture two');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('59000000-0000-4000-8000-000000000010', '59000000-0000-4000-8000-000000000001', 'owner'),
  ('59000000-0000-4000-8000-000000000020', '59000000-0000-4000-8000-000000000002', 'owner');
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at) VALUES
  ('notification-one-hash', 'notification-one-session', '59000000-0000-4000-8000-000000000001', now(), now() + interval '1 hour'),
  ('notification-two-hash', 'notification-two-session', '59000000-0000-4000-8000-000000000002', now(), now() + interval '1 hour');

SELECT lives_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.remanded', NULL, NULL, '59000000-0000-4000-8000-000000000099') $$, 'authorized internal caller can create a fixed event');
SELECT is(private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.remanded', NULL, NULL, '59000000-0000-4000-8000-000000000099'), NULL::uuid, 'repeated event occurrence is deduplicated');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type = 'report.remanded'), 1::bigint, 'duplicate does not create another row');
SELECT is((SELECT category FROM public.notifications WHERE event_type = 'report.remanded'), 'action_required', 'event determines category');
SELECT is((SELECT content FROM public.notifications WHERE event_type = 'report.remanded'), '内容を確認して修正してください。', 'event uses fixed PHI-free content');
SELECT is((SELECT read_at FROM public.notifications WHERE event_type = 'report.remanded'), NULL::timestamptz, 'new notification is unread with no read time');

INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('59000000-0000-4000-8000-000000000020', '59000000-0000-4000-8000-000000000001', 'member');
SELECT lives_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000020', 'report.remanded', NULL, NULL, '59000000-0000-4000-8000-000000000099') $$, 'the same occurrence key is independent across organizations');
SELECT lives_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000020', 'report.remanded', NULL, NULL, '59000000-0000-4000-8000-000000000099') $$, 'the same occurrence key is independent across recipients');
SELECT lives_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.approved', NULL, NULL, '59000000-0000-4000-8000-000000000099') $$, 'the same occurrence key is independent across event types');
SELECT is((SELECT count(*) FROM public.notifications WHERE dedupe_key = '59000000-0000-4000-8000-000000000099'), 4::bigint, 'dedupe scope includes receiver, organization and event type');

SELECT throws_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000010', 'report.approved') $$, '42501', 'notification_receiver_not_member', 'ordinary events reject a receiver from another tenant');
SELECT throws_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.approved', NULL, '59000000-0000-4000-8000-000000000002') $$, '42501', 'notification_actor_not_member', 'actor must belong to the event tenant');
SELECT throws_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.approved', '59000000-0000-4000-8000-000000000088') $$, '42501', 'notification_resource_invalid', 'unverified resources cannot be attached');
SELECT throws_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000001', NULL, 'report.saved') $$, '22023', 'invalid_notification_event', 'routine save success is not a notification event');
SELECT lives_ok($$ SELECT private.create_notification('59000000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000010', 'account.removed_from_organization', '59000000-0000-4000-8000-000000000002') $$, 'removal result supports a receiver without current membership');

SET LOCAL ROLE service_role;
SELECT lives_ok($$ SELECT public.create_notification('59000000-0000-4000-8000-000000000001', 'backup.failed', NULL, NULL, NULL, '59000000-0000-4000-8000-000000000099') $$, 'existing backup infrastructure can create system warning');
SELECT is(public.create_notification('59000000-0000-4000-8000-000000000001', 'backup.failed', NULL, NULL, NULL, '59000000-0000-4000-8000-000000000099'), NULL::uuid, 'null organization system events are also deduplicated');
SELECT throws_ok($$ SELECT public.create_notification('59000000-0000-4000-8000-000000000001', 'report.approved', NULL) $$, '42501', 'notification_requires_business_rpc', 'service adapter cannot replace ordinary authorized business RPCs');
RESET ROLE;
INSERT INTO public.notifications (id, user_id, type, content) VALUES
  ('59000000-0000-4000-8000-000000000031', '59000000-0000-4000-8000-000000000001', 'approve', 'Legacy fixture');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"59000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"notification-one-session"}', true);
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id = '59000000-0000-4000-8000-000000000002'), 0::bigint, 'other-user notifications are invisible');
WITH changed AS (UPDATE public.notifications SET is_read = true WHERE user_id = '59000000-0000-4000-8000-000000000002' RETURNING id)
SELECT is((SELECT count(*) FROM changed), 0::bigint, 'other-user notifications cannot be marked read');
SELECT lives_ok($$ UPDATE public.notifications SET is_read = true WHERE id = '59000000-0000-4000-8000-000000000031' $$, 'old application can mark a legacy notification read');
SELECT ok((SELECT is_read AND read_at IS NOT NULL FROM public.notifications WHERE id = '59000000-0000-4000-8000-000000000031'), 'read flag and timestamp are consistent');
SELECT set_config('notification_test.event_read', (SELECT id::text FROM public.notifications WHERE organization_id = '59000000-0000-4000-8000-000000000010' AND event_type = 'report.remanded'), true);
UPDATE public.notifications SET is_read = true WHERE id = current_setting('notification_test.event_read')::uuid;
SELECT set_config('notification_test.event_read_at', (SELECT read_at::text FROM public.notifications WHERE id = current_setting('notification_test.event_read')::uuid), true);
SELECT set_config('notification_test.first_read', (SELECT read_at::text FROM public.notifications WHERE id = '59000000-0000-4000-8000-000000000031'), true);
UPDATE public.notifications SET is_read = true WHERE id = '59000000-0000-4000-8000-000000000031';
SELECT is((SELECT read_at::text FROM public.notifications WHERE id = '59000000-0000-4000-8000-000000000031'), current_setting('notification_test.first_read'), 'repeated read preserves the first timestamp');
UPDATE public.notifications SET is_read = false WHERE id = '59000000-0000-4000-8000-000000000031';
SELECT is((SELECT read_at FROM public.notifications WHERE id = '59000000-0000-4000-8000-000000000031'), NULL::timestamptz, 'unread state clears timestamp');
SELECT throws_ok($$ UPDATE public.notifications SET content = 'changed' WHERE id = '59000000-0000-4000-8000-000000000031' $$, '42501', 'permission denied for table notifications', 'recipient cannot rewrite notification content');

SELECT set_config('request.jwt.claims', '{"sub":"59000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"notification-two-session"}', true);
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type = 'account.removed_from_organization'), 1::bigint, 'removed member can read their own removal result');
SELECT lives_ok($$ UPDATE public.notifications SET is_read = true WHERE event_type = 'account.removed_from_organization' $$, 'removed member can mark their own result read');
SELECT set_config('request.jwt.claims', '{"sub":"59000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"expired-session"}', true);
WITH changed AS (UPDATE public.notifications SET is_read = false RETURNING id)
SELECT is((SELECT count(*) FROM changed), 0::bigint, 'inactive session cannot update notifications');
RESET ROLE;
SELECT is(private.create_notification('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000010', 'report.remanded', NULL, NULL, '59000000-0000-4000-8000-000000000099'), NULL::uuid, 'retrying a read event still returns duplicate');
SELECT ok((SELECT is_read AND read_at::text = current_setting('notification_test.event_read_at') FROM public.notifications WHERE id = current_setting('notification_test.event_read')::uuid), 'dedupe retries preserve the existing read state and first read time');
SELECT * FROM finish();
ROLLBACK;

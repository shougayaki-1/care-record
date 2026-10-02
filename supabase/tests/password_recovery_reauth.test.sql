-- Run only on the migrated local/test database; all fixtures roll back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(13);

SELECT ok(NOT has_function_privilege('authenticated', 'public.reserve_password_reset_request(text,text)', 'EXECUTE'), 'browser cannot bypass reset request limiting');
SELECT ok(NOT has_table_privilege('authenticated', 'public.password_reset_requests', 'SELECT'), 'request hashes are private');
SELECT ok(NOT has_function_privilege('authenticated', 'public.request_own_account_deletion(text)', 'EXECUTE'), 'old ungated account deletion is inaccessible');
SELECT ok(public.reserve_password_reset_request(repeat('a',64), repeat('b',64)), 'first request is reserved');
SELECT ok(NOT public.reserve_password_reset_request(repeat('a',64), repeat('b',64)), 'immediate resend is blocked');
SELECT ok(public.reserve_password_reset_request(repeat('c',64), repeat('b',64)), 'a different email can be reserved below network limit');
INSERT INTO public.password_reset_requests(email_hash,ip_hash) VALUES (repeat('d',64),repeat('b',64)), (repeat('e',64),repeat('b',64)), (repeat('f',64),repeat('b',64));
SELECT ok(NOT public.reserve_password_reset_request(repeat('1',64),repeat('b',64)), 'network limit applies across emails');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES ('30111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','issue30@example.invalid','x',now(),now(),now());
INSERT INTO public.profiles(id,name) VALUES ('30111111-0000-0000-0000-000000000001','Issue 30 fixture') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name;
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
VALUES ('issue30-hash','issue30-session','30111111-0000-0000-0000-000000000001',now(),now()+interval '1 hour');
INSERT INTO public.reauth_grants(token_hash,user_id,auth_session_id,purpose,expires_at)
VALUES (encode(extensions.digest('delete-proof','sha256'),'hex'),'30111111-0000-0000-0000-000000000001','issue30-session','account_delete',now()+interval '10 minutes'),
       (encode(extensions.digest('email-proof','sha256'),'hex'),'30111111-0000-0000-0000-000000000001','issue30-session','account_email_change',now()+interval '10 minutes'),
       (encode(extensions.digest('wrong-session-proof','sha256'),'hex'),'30111111-0000-0000-0000-000000000001','another-session','account_delete',now()+interval '10 minutes');
INSERT INTO public.reauth_grants(token_hash,user_id,auth_session_id,purpose,created_at,expires_at)
VALUES (encode(extensions.digest('expired-proof','sha256'),'hex'),'30111111-0000-0000-0000-000000000001','issue30-session','account_delete',now()-interval '11 minutes',now()-interval '1 minute');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"30111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"issue30-session"}',true);
SELECT throws_ok($$ SELECT public.request_own_account_deletion('test','forged') $$, 'P0001','account_delete_requires_reauthentication','forged proof cannot delete');
SELECT throws_ok($$ SELECT public.request_own_account_deletion('test','email-proof') $$, 'P0001','account_delete_requires_reauthentication','wrong purpose cannot delete');
SELECT throws_ok($$ SELECT public.request_own_account_deletion('test','wrong-session-proof') $$, 'P0001','account_delete_requires_reauthentication','another session cannot delete');
SELECT throws_ok($$ SELECT public.request_own_account_deletion('test','expired-proof') $$, 'P0001','account_delete_requires_reauthentication','expired proof cannot delete');
SELECT lives_ok($$ SELECT public.request_own_account_deletion('test','delete-proof') $$, 'correct grant permits deletion');
SELECT throws_ok($$ SELECT public.request_own_account_deletion('test','delete-proof') $$, 'P0001','account_delete_requires_reauthentication','proof cannot be replayed');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

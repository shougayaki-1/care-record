import subprocess,time,uuid,threading,sys

# This test commits synthetic rows. It must only target a marked disposable database.
if len(sys.argv) != 3 or not sys.argv[1].startswith("supabase_db_") or sys.argv[2] != "issue168_fixture":
 raise SystemExit("Pass the local Supabase container and disposable issue168_fixture database")
container, database = sys.argv[1:]
base=['docker','exec','-i',container,'psql','-U','postgres','-d',database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1']
def query(sql):
 p=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=15)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout.strip()
if query("select coalesce(shobj_description(oid, 'pg_database'),'') from pg_database where datname=current_database()") != 'care-record-issue168-disposable':
 raise SystemExit('Database is not marked as disposable')
class Session:
 def __init__(self,name):
  self.p=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  self.seq=0;self.run("\\set VERBOSITY verbose\nset application_name='"+name+"'; set statement_timeout='10s';")
 def run(self,sql):
  self.seq+=1; marker='END_'+str(self.seq);self.p.stdin.write(sql+'\n\\echo '+marker+'\n');self.p.stdin.flush();out=[]
  while True:
   line=self.p.stdout.readline()
   if not line: raise RuntimeError(self.p.stderr.read())
   if line.strip()==marker:return '\n'.join(out)
   out.append(line)
 def close(self): self.p.stdin.write('rollback;\n\\q\n');self.p.stdin.flush();self.p.wait(timeout=5)
def uid():return str(uuid.uuid4())
def setup():
 u,c,s,cons,o=map(lambda _:uid(),range(5))
 query(f"""insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values ('{u}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{u}@example.invalid','x',now(),now());
insert into public.organizations(id,name) values ('{o}','Synthetic');
insert into public.organization_members(organization_id,user_id,role) values ('{o}','{u}','owner');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values ('{c}','dynamic','http://localhost/callback','authorization_code','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values ('{cons}','{u}','{c}','openid');
insert into auth.sessions(id,user_id,oauth_client_id) values ('{s}','{u}','{c}');
insert into private.mcp_import_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('{o}',true,'{{}}','{u}',now());""")
 return u,c,s,cons,o
def wait_lock(name):
 for _ in range(100):
  if query(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock';")=='1':return
  time.sleep(.05)
 raise RuntimeError('did not observe lock '+name)
for mode in ('send-revoke','revoke-send','send-leave','leave-send'):
 u,c,s,cons,o=setup();a=Session('issue168_a');b=Session('issue168_b')
 claims=f'{{"sub":"{u}","role":"mcp_import","exp":4102444800,"client_id":"{c}","session_id":"{s}"}}'
 send=f"select public.submit_mcp_candidate('{o}','','{{\"meta\":{{}},\"values\":{{}},\"warnings\":[],\"confidence\":\"low\"}}');"
 revoke=f"update auth.oauth_consents set revoked_at=now() where id='{cons}'; delete from auth.sessions where id='{s}';"
 leave=f"delete from public.organization_members where organization_id='{o}' and user_id='{u}';"
 operation=revoke if 'revoke' in mode else leave
 try:
  if mode.startswith('send-'):
   a.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true); {send}")
   b.run('begin;'); err=[]
   def run_operation():
    try: b.run(operation)
    except Exception as e: err.append(str(e))
   t=threading.Thread(target=run_operation,daemon=True);t.start();wait_lock('issue168_b');a.run('commit;');t.join(10)
   if t.is_alive():raise RuntimeError('blocked operation did not finish')
   if err: raise RuntimeError('blocked operation failed: '+repr(err))
   b.run('commit;')
   assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='1'
  else:
   a.run('begin; '+operation);b.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
   result=[]
   def run():
    try: b.run(send); result.append('success')
    except Exception as e: result.append(str(e))
   t=threading.Thread(target=run,daemon=True);t.start();wait_lock('issue168_b');a.run('commit;');t.join(10)
   if t.is_alive():raise RuntimeError('send did not finish')
   expected='mcp_oauth_required' if 'revoke' in mode else 'mcp_import_unavailable'
   assert len(result)==1 and '42501' in result[0] and expected in result[0],result
   assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='0'
  print('PASS',mode,flush=True)
 finally:
  a.close()
  if b.p.poll() is None:b.close()

# Observe read behavior while removal is uncommitted; neither read currently
# takes a membership lock. A later call must see the committed removal.
u,c,s,cons,o=setup();remover=Session('issue168_read_remove');reader=Session('issue168_read')
claims=f'{{"sub":"{u}","role":"mcp_import","exp":4102444800,"client_id":"{c}","session_id":"{s}"}}'
try:
 remover.run(f"begin; delete from public.organization_members where organization_id='{o}' and user_id='{u}';")
 reader.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
 before=reader.run(f"select count(*) from public.list_mcp_workspaces() where id='{o}'; select public.get_mcp_self_staff_names('{o}');")
 assert before.strip().startswith('1'), before
 reader.run('commit;');remover.run('commit;')
 reader.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
 after=reader.run(f"select count(*) from public.list_mcp_workspaces() where id='{o}';")
 assert after.strip()=='0',after
 print('PASS read observes uncommitted membership until deletion commits; subsequent list is empty',flush=True)
finally:
 remover.close();reader.close()

# READ COMMITTED establishes a statement snapshot. A read already in progress
# may complete after revoke; a later statement must fail with the same JWT.
u,c,s,cons,o=setup(); revoker=Session('issue168_snapshot_revoke'); reader=Session('issue168_snapshot_read')
claims=f'{{"sub":"{u}","role":"mcp_import","exp":4102444800,"client_id":"{c}","session_id":"{s}"}}'
try:
 reader.run(f"begin read only; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
 observed=[];errors=[]
 def slow_read():
  try: observed.append(reader.run(f"select count(*) from (select pg_sleep(2)) delay cross join lateral public.list_mcp_workspaces() w where w.id='{o}';"))
  except Exception as e: errors.append(str(e))
 t=threading.Thread(target=slow_read,daemon=True);t.start()
 for _ in range(100):
  if query("select count(*) from pg_stat_activity where application_name='issue168_snapshot_read' and wait_event='PgSleep'")=='1':break
  time.sleep(.02)
 else:raise RuntimeError('read did not enter PgSleep')
 revoker.run(f"begin; update auth.oauth_consents set revoked_at=now() where id='{cons}'; delete from auth.sessions where id='{s}'; commit;")
 t.join(5)
 if t.is_alive() or errors:raise RuntimeError('slow read failed or timed out: '+repr(errors))
 assert observed[0].strip()=='1',observed
 try:reader.run('select public.list_mcp_workspaces();')
 except Exception as e:
  assert '42501' in str(e) and 'mcp_oauth_required' in str(e),str(e)
 else:raise AssertionError('new statement after revoke unexpectedly succeeded')
 print('PASS in-flight statement snapshot; next statement rejects revoked JWT',flush=True)
finally:
 revoker.close()
 if reader.p.poll() is None:reader.close()

# A lock wait can cross not_after. The final pre-insert check must reject.
u,c,s,cons,o=setup(); locker=Session('issue168_expiry_lock');sender=Session('issue168_expiry_send')
claims=f'{{"sub":"{u}","role":"mcp_import","exp":4102444800,"client_id":"{c}","session_id":"{s}"}}'
try:
 query(f"update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='{s}';")
 locker.run(f"begin; select pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_candidate:' || '{u}', 0));")
 sender.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
 result=[]
 def blocked_send():
  try:sender.run(f"select public.submit_mcp_candidate('{o}','','{{\"meta\":{{}},\"values\":{{}},\"warnings\":[],\"confidence\":\"low\"}}');");result.append('success')
  except Exception as e:result.append(str(e))
 t=threading.Thread(target=blocked_send,daemon=True);t.start();wait_lock('issue168_expiry_send')
 for _ in range(100):
  if query(f"select (not_after <= clock_timestamp())::text from auth.sessions where id='{s}'")=='true':break
  time.sleep(.05)
 else:raise RuntimeError('session did not expire')
 locker.run('commit;');t.join(10)
 if t.is_alive():raise RuntimeError('expiry test timed out')
 assert len(result)==1 and '42501' in result[0] and 'mcp_oauth_required' in result[0],result
 assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='0'
 print('PASS session expiration during advisory-lock wait rejects before insert',flush=True)
finally:
 locker.close()
 if sender.p.poll() is None:sender.close()

# A valid JWT can expire while the sender waits for the candidate lock.
u,c,s,cons,o=setup(); locker=Session('issue168_jwt_lock');sender=Session('issue168_jwt_send')
expiry=int(time.time())+3
claims=f'{{"sub":"{u}","role":"mcp_import","exp":{expiry},"client_id":"{c}","session_id":"{s}"}}'
try:
 locker.run(f"begin; select pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_candidate:' || '{u}', 0));")
 sender.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{claims}',true);")
 result=[]
 def jwt_blocked_send():
  try:sender.run(f"select public.submit_mcp_candidate('{o}','','{{\"meta\":{{}},\"values\":{{}},\"warnings\":[],\"confidence\":\"low\"}}');");result.append('success')
  except Exception as e:result.append(str(e))
 t=threading.Thread(target=jwt_blocked_send,daemon=True);t.start();wait_lock('issue168_jwt_send')
 while time.time() < expiry + .1:time.sleep(.05)
 locker.run('commit;');t.join(10)
 if t.is_alive():raise RuntimeError('JWT expiry test timed out')
 assert len(result)==1 and '42501' in result[0] and 'mcp_oauth_required' in result[0],result
 assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='0'
 print('PASS JWT expiration during advisory-lock wait rejects before insert',flush=True)
finally:
 locker.close()
 if sender.p.poll() is None:sender.close()

# Use the real role-management RPCs and the same organization lock as submit.
for change in ('permissions', 'assignment'):
 for order in ('send-first', 'change-first'):
  u,c,s,cons,o=setup(); manager,all_role,none_role=uid(),uid(),uid()
  session_id='session-'+uid()
  query(f"""insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values ('{manager}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{manager}@example.invalid','x',now(),now());
    update public.organization_members set role='member' where organization_id='{o}' and user_id='{u}';
    insert into public.organization_members(organization_id,user_id,role) values ('{o}','{manager}','owner');
    insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
      values ('{session_id}','{session_id}','{manager}',now(),now()+interval '1 hour');
    insert into public.organization_roles(id,organization_id,name,permissions) values
      ('{all_role}','{o}','all','{{"records":{{"create":"all"}}}}'),
      ('{none_role}','{o}','none','{{"records":{{"create":"none"}}}}');
    insert into public.organization_member_roles(organization_id,user_id,role_id) values ('{o}','{u}','{all_role}');""")
  sender=Session('issue168_role_sender');manager_session=Session('issue168_role_manager')
  mcp_claims=f'{{"sub":"{u}","role":"mcp_import","exp":4102444800,"client_id":"{c}","session_id":"{s}"}}'
  manager_claims=f'{{"sub":"{manager}","role":"authenticated","session_id":"{session_id}"}}'
  send=f"select public.submit_mcp_candidate('{o}','','{{\"meta\":{{}},\"values\":{{}},\"warnings\":[],\"confidence\":\"low\"}}');"
  if change=='permissions':
   operation=f"select public.mutate_organization_role_authorized('{o}','{all_role}','update','all',null,'{{\"records\":{{\"create\":\"none\"}}}}',false);"
  else:
   operation=f"select public.account_replace_member_roles('{o}','{u}',array['{none_role}'::uuid]);"
  try:
   sender.run(f"begin; set local role mcp_import; select set_config('request.jwt.claims','{mcp_claims}',true);")
   manager_session.run(f"begin; set local role authenticated; select set_config('request.jwt.claims','{manager_claims}',true);")
   errors=[]
   if order=='send-first':
    sender.run(send)
    def change_action():
     try:manager_session.run(operation)
     except Exception as e:errors.append(str(e))
    t=threading.Thread(target=change_action,daemon=True);t.start();wait_lock('issue168_role_manager')
    sender.run('commit;');t.join(10)
    if t.is_alive() or errors:raise RuntimeError('role change failed or timed out: '+repr(errors))
    manager_session.run('commit;')
    assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='1'
   else:
    manager_session.run(operation)
    def send_action():
     try:sender.run(send);errors.append('unexpected success')
     except Exception as e:errors.append(str(e))
    t=threading.Thread(target=send_action,daemon=True);t.start();wait_lock('issue168_role_sender')
    manager_session.run('commit;');t.join(10)
    if t.is_alive():raise RuntimeError('send timed out')
    assert len(errors)==1 and '42501' in errors[0] and 'mcp_import_unavailable' in errors[0],errors
    assert query(f"select count(*) from public.ai_import_candidates where organization_id='{o}'")=='0'
   print('PASS role',change,order,flush=True)
  finally:
   if sender.p.poll() is None:sender.close()
   if manager_session.p.poll() is None:manager_session.close()

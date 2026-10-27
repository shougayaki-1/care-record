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
insert into public.organization_members(organization_id,user_id,role) values ('{o}','{u}','member');
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
 claims=f'{{"sub":"{u}","role":"mcp_import","client_id":"{c}","session_id":"{s}"}}'
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
claims=f'{{"sub":"{u}","role":"mcp_import","client_id":"{c}","session_id":"{s}"}}'
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

# Run only against the dedicated disposable care-record-181-db stack.
# This creates synthetic users and data; it does not delete data or call remote services.
import subprocess,json,base64,hashlib,urllib.request,urllib.error
status=subprocess.run(['npx','--yes','supabase@2.108.0','status','--workdir','/private/tmp/care-record-181-db','-o','env'],capture_output=True,text=True,check=True).stdout
settings=dict(line.split('=',1) for line in status.splitlines() if '=' in line)
import uuid
api=settings['API_URL'].strip('"'); service=settings['SERVICE_ROLE_KEY'].strip('"'); anon=settings['ANON_KEY'].strip('"')
if api != 'http://127.0.0.1:59721':
 raise RuntimeError('The dedicated local Supabase API is required')
email=f"mcp-smoke-{uuid.uuid4()}@example.invalid"; password=uuid.uuid4().hex + 'Aa1!'
def auth(path, data, key):
 request=urllib.request.Request(api+path,json.dumps(data).encode(),{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(request,timeout=20) as response: return json.load(response)
auth('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},service)
token=auth('/auth/v1/token?grant_type=password',{'email':email,'password':password},anon)['access_token']

import urllib.parse
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self, req, fp, code, msg, headers, newurl): return None
opener=urllib.request.build_opener(NoRedirect)
client=auth('/auth/v1/oauth/clients/register',{'client_name':'Synthetic MCP','redirect_uris':['http://localhost:47833/callback'],'grant_types':['authorization_code'],'response_types':['code'],'token_endpoint_auth_method':'none','client_type':'public'},anon)
verifier=uuid.uuid4().hex+uuid.uuid4().hex
challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
params=urllib.parse.urlencode({'client_id':client['client_id'],'redirect_uri':'http://localhost:47833/callback','response_type':'code','scope':'openid','code_challenge':challenge,'code_challenge_method':'S256'})
request=urllib.request.Request(api+'/auth/v1/oauth/authorize?'+params,headers={'apikey':anon,'Authorization':'Bearer '+token})
try:
 with opener.open(request,timeout=20) as r: raise RuntimeError('expected consent redirect')
except urllib.error.HTTPError as e:
 if e.code != 302: raise
 authid=urllib.parse.parse_qs(urllib.parse.urlparse(e.headers['Location']).query)['authorization_id'][0]
details=urllib.request.Request(api+'/auth/v1/oauth/authorizations/'+authid,headers={'apikey':anon,'Authorization':'Bearer '+token})
try:
 with urllib.request.urlopen(details,timeout=20) as response: print('details',response.status)
except urllib.error.HTTPError as e:
 print('details error',e.code,e.read().decode()[:700]); raise SystemExit(1)
request=urllib.request.Request(api+'/auth/v1/oauth/authorizations/'+authid+'/consent',json.dumps({'action':'approve'}).encode(),{'apikey':anon,'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
try:
 with urllib.request.urlopen(request,timeout=20) as response: approval=json.load(response)
except urllib.error.HTTPError as e:
 print('consent error',e.code,e.read().decode()[:700]); raise SystemExit(1)
code=urllib.parse.parse_qs(urllib.parse.urlparse(approval['redirect_url']).query)['code'][0]
oauth=auth('/auth/v1/oauth/token',{'grant_type':'authorization_code','code':code,'redirect_uri':'http://localhost:47833/callback','client_id':client['client_id'],'code_verifier':verifier},anon)
claims=json.loads(base64.urlsafe_b64decode(oauth['access_token'].split('.')[1]+'==='))
assert claims.get('role') == 'mcp_import' and claims.get('client_id') == client['client_id']
print('OAuth token issued with expected role')
user=claims['sub']; oauth_client=claims['client_id']; browser_claims=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'===')); browser_session=browser_claims['session_id']; org,shift,staff,person=[str(uuid.uuid4()) for _ in range(4)]
def sql(statement):
 result=subprocess.run(['docker','exec','-i','supabase_db_care-record-181-snapshot','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True,check=True); return result.stdout.strip()
sql(f"""insert into public.organizations(id,name) values ('{org}','Synthetic OAuth org');
insert into public.organization_members(organization_id,user_id,role) values ('{org}','{user}','owner');
insert into public.clients(id,organization_id,name) values ('{person}','{org}','Synthetic client');
insert into public.staffs(id,organization_id,name) values ('{staff}','{org}','Synthetic staff');
insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values ('{shift}','{org}','{person}','2026-11-01 00:00+00','2026-11-01 01:00+00','published');
insert into private.mcp_shift_read_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('{org}',true,'{{}}','{user}',now());
insert into private.mcp_person_search_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('{org}',true,'{{}}','{user}',now());
insert into private.mcp_shift_cancel_controls(organization_id,enabled,conditions,confirmed_by,confirmed_at) values ('{org}',true,'{{}}','{user}',now());
insert into private.mcp_reauth_proofs(user_id,client_id,consent_granted_at,verified_at) select user_id,client_id,granted_at,clock_timestamp() from auth.oauth_consents where user_id='{user}' and client_id='{oauth_client}';
insert into public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) values ('synthetic-{browser_session}','{browser_session}','{user}',now(),now()+interval '1 hour');""")
token=oauth['access_token']; url='http://127.0.0.1:59721/functions/v1/care-record-mcp'
def mcp(method,params):
 request=urllib.request.Request(url,json.dumps({'jsonrpc':'2.0','id':2,'method':method,'params':params}).encode(),{'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'},method='POST')
 with urllib.request.urlopen(request,timeout=30) as response: body=response.read().decode()
 line=next(x[6:] for x in body.splitlines() if x.startswith('data: ')); data=json.loads(line)
 if 'error' in data or data.get('result',{}).get('isError'): raise RuntimeError(json.dumps(data,ensure_ascii=False))
 return data['result']
mcp('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'synthetic-test','version':'1.0'}})
def call(name,args): return mcp('tools/call',{'name':name,'arguments':args})['structuredContent']
for operation in ('cancel','soft_delete'):
 if operation == 'soft_delete':
  shift=str(uuid.uuid4())
  sql(f"insert into public.shifts(id,organization_id,client_id,start_at,end_at,status) values ('{shift}','{org}','{person}','2026-11-02 00:00+00','2026-11-02 01:00+00','published'); insert into public.retention_policies(organization_id,resource_type,retention_years,legal_basis,reviewed_at,reviewed_by) values ('{org}','shift',5,'synthetic',now(),'{user}');")
 report=str(uuid.uuid4())
 sql(f"insert into public.reports(id,client_id,helper_id,status,shift_id) values ('{report}','{person}','{user}','draft','{shift}');")
 args={'organization_id':org,'shift_id':shift,'operation':operation,'reason':'synthetic'}
 proposal=call('prepare_shift_cancel',args)['proposal_id']
 assert call('get_shift_cancel_result',{'organization_id':org,'proposal_id':proposal})['result']['status']=='confirmation_required'
 assert sql(f"select status from public.shifts where id='{shift}';")=='published'
 browser=json.dumps({'sub':user,'role':'authenticated','session_id':browser_session},separators=(',',':'))
 confirmed=sql(f"begin; set local role authenticated; select set_config('request.jwt.claims','{browser}',true); select public.confirm_mcp_shift_cancel('{proposal}'); commit;")
 assert '"status": "updated"' in confirmed,confirmed
 result=call('get_shift_cancel_result',{'organization_id':org,'proposal_id':proposal})['result']
 assert result['status']=='updated' and result['operation']==operation
 if operation == 'cancel':
  assert sql(f"select status from public.shifts where id='{shift}';")=='cancelled'
  assert result['google_sync_status']=='pending_upsert'
 else:
  assert sql(f"select (deleted_at is not null)::text from public.shifts where id='{shift}';")=='true'
  assert result['google_sync_status']=='pending_delete'
 assert sql(f"select count(*) from public.shifts where id='{shift}';")=='1'
 assert sql(f"select count(*) from public.reports where id='{report}' and shift_id='{shift}';")=='1'
 audit='shift.cancel' if operation == 'cancel' else 'shift.bulk_soft_delete'
 assert sql(f"select count(*) from public.audit_events where organization_id='{org}' and resource_id='{shift}' and action_type='{audit}';")=='1'
 print(f'PASS: OAuth → MCP {operation} proposal → browser RPC → result; shift retained')

// Real two-connection DDL tests. Clone ONLY a guarded disposable prepared DB;
// the outer stack is destroyed after this suite. No hosted DB URLs accepted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { verifyRestoredDatabase } from '../audit/cutover-control.mjs';
import { inventorySummary, readInventory } from '../audit/cutover-inventory.mjs';
const container=process.argv[2];
if(!/^supabase_db_care-record-(?:audit-v2-test|owner-add-test)(?:-[a-z0-9]+)?$/.test(container??''))
  throw new Error('Pass a dedicated disposable audit-v2-test or owner-add-test container.');
const database=`audit_cutover_151_test_${process.pid}`;
const cutover='15100000-0000-4000-8000-000000000001';
const evidence='1'.repeat(64);
const migration=readFileSync(new URL('../../supabase/manual-migrations/20261025000001_audit_v2_cutover.sql',import.meta.url),'utf8');
// CLI images differ in socket auth. Use ONLY the guarded container's existing
// local password inside that container: never inspect, print, or pass its value
// through host argv. No host/cloud credentials or hosted DB URLs are accepted.
const command=(program,parameters)=>['exec','-i',container,'sh','-c',
  'PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"','audit-cutover-fixture',program,...parameters];
const args=(db,role='postgres')=>command('psql',['-w','-X','-At','-U',role,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']);
// Supabase provisions graphql_public.graphql through extension hooks. Some
// image versions dump its ACL without recreating the managed wrapper. GraphQL
// is outside this audit restore contract; retain all application/Auth/Storage
// schemas, ownership, ACLs, triggers and data, and keep ON_ERROR_STOP enabled.
const dumpArgs=(db,schemaOnly=false)=>command('pg_dump',['-w','-U','supabase_admin',
  '--exclude-schema=graphql_public',...(schemaOnly?['--schema-only']:[]),db]);
function sql(input,db=database,role='postgres') {
  const r=spawnSync('docker',args(db,role),{input,encoding:'utf8',timeout:40_000});
  if(r.error || r.status!==0)throw new Error(r.stderr||'cutover_test_failed');
  return r.stdout.trim();
}
const graphqlDefinition=sql(`SELECT coalesce((SELECT pg_get_functiondef(p.oid) || E';\n' ||
  format('ALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO %I;',pg_get_userbyid(p.proowner))
  FROM pg_proc p WHERE p.oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)')),'');`,'postgres','supabase_admin');
function restore(dump,db) {
  // Other Supabase extension/default-ACL definitions still name this namespace.
  // Bootstrap the REAL source wrapper and its owner, never a stub. Its SQL
  // dependency is restored by pg_graphql later in the dump, as with pg_dump's
  // own check_function_bodies=false restore ordering. ACLs then apply normally.
  sql('CREATE SCHEMA graphql_public; SET check_function_bodies=false;'+graphqlDefinition,db,'supabase_admin');
  sql(dump,db,'supabase_admin');
}
const sessions=[];
class Session {
  constructor(name) {
    this.name=name;this.counter=0;this.output='';this.errors='';
    this.process=spawn('docker',args(database));sessions.push(this);
    this.process.stdout.on('data',bytes=>{
      this.output+=bytes;
      if(this.pending && this.output.includes(this.pending.marker)) {
        clearTimeout(this.pending.timer);this.pending.resolve(this.output);this.pending=null;
      }
    });
    this.process.stderr.on('data',bytes=>{this.errors+=bytes;});
    this.exit=new Promise(resolve=>this.process.on('close',code=>{
      this.closed=true;
      if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error(this.errors));this.pending=null;}
      resolve(code);
    }));
  }
  query(command) {
    assert.ok(!this.pending);
    return new Promise((resolve,reject)=>{
      const marker=`AUDIT151_${this.name}_${++this.counter}`;
      this.pending={resolve,reject,marker,timer:setTimeout(()=>{reject(new Error('cutover_query_timeout'));this.process.kill();},35_000)};
      this.process.stdin.write(`${command}\nSELECT '${marker}';\n`);
    });
  }
  async begin(level='READ COMMITTED') {
    await this.query(`SET application_name='audit151-${this.name}';SET statement_timeout='30s';BEGIN ISOLATION LEVEL ${level};`);
  }
  async finish() {await this.query('COMMIT;');this.process.stdin.end();assert.equal(await this.exit,0,this.errors);}
}
async function waiting(name) {
  const deadline=Date.now()+10_000;
  while(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='audit151-${name}' AND wait_event_type='Lock';`)!=='1') {
    if(Date.now()>deadline)throw new Error('cutover_expected_lock_wait');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
}
const insert=label=>`INSERT INTO public.audit_events(action_type,resource_type) VALUES('${label}','test');`;
const configured=`SET care_record.audit_cutover_id='${cutover}';SET care_record.audit_cutover_evidence='${evidence}';`;
function state() {return sql(`SELECT (SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef WHERE adrelid='public.audit_events'::regclass
  AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid='public.audit_events'::regclass AND attname='integrity_version'))
  || ':' || (SELECT tgfoid::regproc::text FROM pg_trigger WHERE tgrelid='public.audit_events'::regclass AND tgname='audit_events_chain_insert');`);}
function snapshot(db) {
  const result=JSON.parse(sql(`SELECT json_build_object('cutoverId',cutover_id,'ordinal','1','v1Count',v1_count::text,
    'heads',(SELECT json_agg(json_build_object('scope',scope,'sequence',last_sequence::text,'hash',last_hash,'cutoverId',cutover_id)) FROM private.audit_chain_heads))
    FROM private.audit_cutover_state;`,db));
  const items=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('kind','v1','id',id,
    'inventory',replace(encode(private.audit_inventory_bytes(e),'base64'),E'\\n',''))),'[]') FROM public.audit_events e WHERE integrity_version=1;`,db));
  result.v1Digest=inventorySummary(readInventory(items)).v1Digest;
  return result;
}
try {
  const emptyDatabase=`audit_cutover_151_empty_${process.pid}`;
  const schema=spawnSync('docker',dumpArgs('postgres',true),{encoding:'utf8',timeout:30_000,maxBuffer:32*1024*1024});
  assert.equal(schema.status,0,schema.stderr);
  sql(`CREATE DATABASE ${emptyDatabase} TEMPLATE template0;`,'postgres');
  restore(schema.stdout,emptyDatabase);
  sql(configured+migration,emptyDatabase);
  sql(insert('fixture.cutover.empty-old-app'),emptyDatabase);
  assert.equal(sql("SELECT integrity_version::text||':'||chain_sequence::text FROM public.audit_events;",emptyDatabase),'2:1');
  assert.equal(sql('SELECT v1_count FROM private.audit_cutover_state;',emptyDatabase),'0');
  console.log('PASS: schema-only empty rebuild cuts over and accepts old-app INSERT at sequence 1');
  // Real logical restore also avoids interrupting Supabase's background
  // connections (CREATE DATABASE ... TEMPLATE postgres requires zero clients).
  const dump=spawnSync('docker',dumpArgs('postgres'),{encoding:'utf8',timeout:30_000,maxBuffer:32*1024*1024});
  assert.equal(dump.status,0,dump.stderr);
  sql(`CREATE DATABASE ${database} TEMPLATE template0;`,'postgres');
  restore(dump.stdout,database);
  assert.equal(state(),'1:private.chain_audit_event');
  sql(insert('fixture.cutover.existing'));
  const originalRows=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('id',e.id,'digest',encode(extensions.digest(convert_to(to_jsonb(e)::text,'UTF8'),'sha256'),'hex'))),'[]') FROM public.audit_events e WHERE integrity_version=1;`));
  assert.throws(()=>sql(migration),/audit_cutover_approval_required/);
  assert.equal(state(),'1:private.chain_audit_event');
  assert.equal(sql("SELECT to_regclass('private.audit_cutover_state') IS NULL;"),'t');
  const blocker=new Session('timeout');await blocker.begin();await blocker.query(insert('fixture.cutover.timeout'));
  assert.throws(()=>sql(configured+migration),/55P03/);
  // A separate connection observes that the failed migration changed nothing.
  assert.equal(state(),'1:private.chain_audit_event');
  assert.equal(sql("SELECT to_regclass('private.audit_cutover_state') IS NULL;"),'t');
  await blocker.finish();
  console.log('PASS: missing approval and real lock_timeout roll back the entire cutover');

  const before=new Session('before');await before.begin();await before.query(insert('fixture.cutover.before'));
  const old=[];
  for(const [index,level] of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].entries()) {
    const session=new Session(`old-${index}`);await session.begin(level);
    await session.query('SELECT count(*) FROM public.organizations;');old.push(session);
  }
  const ddl=new Session('ddl');
  await ddl.query(`SET application_name='audit151-ddl';${configured}`);
  const pending=ddl.query(migration);const ddlResult=pending.then(()=>null,error=>error);
  await waiting('ddl');
  const queued=new Session('queued');await queued.begin();
  const queuedResult=queued.query(insert('fixture.cutover.queued')).then(()=>null,error=>error);
  await waiting('queued');
  await before.finish();assert.equal(await ddlResult,null);
  assert.equal(await queuedResult,null);await queued.finish();
  ddl.process.stdin.end();assert.equal(await ddl.exit,0,ddl.errors);
  for(const session of old) {
    const result=await session.query(insert(`fixture.cutover.${session.name}`)).then(()=>null,error=>error);
    if(result) {assert.match(result.message,/40001/);await session.exit;}
    else await session.finish();
  }
  sql(insert('fixture.cutover.old-application'));
  assert.equal(state(),'2:private.chain_audit_event_v2');
  assert.equal(sql("SELECT count(*) FROM public.audit_events WHERE action_type LIKE 'fixture.cutover.%' AND action_type NOT IN ('fixture.cutover.existing','fixture.cutover.timeout','fixture.cutover.before') AND integrity_version<>2;"),'0');
  assert.equal(sql("SELECT (SELECT v1_count FROM private.audit_cutover_state)=count(*) FROM public.audit_events WHERE integrity_version=1;"),'t');
  assert.throws(()=>sql(insert('fixture.explicit.v1').replace('resource_type)','resource_type,integrity_version)').replace("'test');","'test',1);")),/audit_v2_managed_fields/);
  assert.throws(()=>sql(configured+migration),/audit_cutover_unexpected_state/);
  assert.equal(sql("SELECT bool_and(event_hash=encode(extensions.digest(private.audit_canonical_v1(e),'sha256'),'hex')) FROM public.audit_events e WHERE integrity_version=1;"),'t');
  const preservedRows=JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('id',e.id,'digest',encode(extensions.digest(convert_to(to_jsonb(e)::text,'UTF8'),'sha256'),'hex'))),'[]') FROM public.audit_events e WHERE integrity_version=1;`));
  for(const original of originalRows)assert.deepEqual(preservedRows.find(row=>row.id===original.id),original);
  console.log('PASS: DDL drains in-flight v1, queued and pre-existing transactions cannot append v1 after the boundary; old INSERT remains compatible');

  for(const role of ['anon','authenticated','service_role'])
    assert.equal(sql(`SELECT bool_or(has_table_privilege('${role}','private.audit_cutover_state',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p;`),'f');
  assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='private.audit_cutover_state'::regclass;"),'t');
  assert.throws(()=>sql("UPDATE private.audit_cutover_state SET evidence_digest=repeat('2',64);"),/audit_events are append-only/);
  // A snapshot restored before the boundary cannot adopt the external GENESIS.
  const external=JSON.parse(sql(`SELECT json_build_object('cutoverId',cutover_id,'ordinal','1','v1Count',v1_count::text,
    'heads',(SELECT json_agg(json_build_object('scope',scope,'sequence',last_sequence::text,'hash',last_hash)) FROM private.audit_chain_heads))
    FROM private.audit_cutover_state;`));
  // Source is the real pre-cutover logical backup restored at the start.
  const oldSnapshot=JSON.parse(sql(`SELECT json_build_object('cutoverId',null,'v1Count',count(*)::text,'heads','[]'::json) FROM public.audit_events WHERE integrity_version=1;`,'postgres'));
  assert.throws(()=>verifyRestoredDatabase(external,oldSnapshot));
  console.log('PASS: cutover boundary has RLS/explicit ACL, is immutable, and an old snapshot cannot reset the external chain');

  // Restore a REAL post-cutover logical backup, then advance the source beyond
  // its frozen head. Comparison must stop a stale restore before any reuse.
  const frozen=snapshot(database), restoredDatabase=`audit_cutover_151_replay_${process.pid}`;
  const v2dump=spawnSync('docker',dumpArgs(database),{encoding:'utf8',timeout:30_000,maxBuffer:32*1024*1024});
  assert.equal(v2dump.status,0,v2dump.stderr);
  sql(`CREATE DATABASE ${restoredDatabase} TEMPLATE template0;`,'postgres');
  restore(v2dump.stdout,restoredDatabase);
  assert.equal(verifyRestoredDatabase(frozen,snapshot(restoredDatabase)).status,'consistent');
  sql(insert('fixture.cutover.after-backup'));
  const latest=snapshot(database);
  assert.throws(()=>verifyRestoredDatabase(latest,snapshot(restoredDatabase)));
  // Deliberately model an unauthorized restart in the disposable restore only:
  // the same number gets a different hash. The operator preflight rejects it.
  sql(insert('fixture.cutover.forked-restart'),restoredDatabase);
  assert.equal(snapshot(restoredDatabase).heads[0].sequence,latest.heads[0].sequence);
  assert.throws(()=>verifyRestoredDatabase(latest,snapshot(restoredDatabase)));
  console.log('PASS: real v2 logical restore matches the frozen head, then rejects stale heads and same-sequence divergent replay');
} finally {
  for(const session of sessions)if(!session.closed){session.process.stdin.end();session.process.kill();}
}

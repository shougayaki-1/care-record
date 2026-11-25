import { describe, expect, it } from 'vitest';
import { sha256, type Event, type Head } from '@/utils/auditArchive/contracts';
import { SnapshotChain } from './snapshot';

const cutover = '15200000-0000-4000-8000-000000000111';
const scope = 'global';
function event(n: number, previousHash: string): Event {
  const id = `15200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const eventId = `15300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const canonical = [2,cutover,scope,String(n),id,eventId,null,null,'synthetic','test',null,'success',null,null,null,'2026-01-01T00:00:00.000000Z',{},null,null,previousHash];
  const bytes = Buffer.from(JSON.stringify(canonical));
  const hash = sha256(bytes);
  const inventory = ['audit-inventory:2',id,eventId,null,null,'synthetic','test',null,'success',null,null,null,canonical[15],{},null,null,previousHash,hash,2,scope,String(n),cutover];
  return { kind:'v2',version:2,scope,sequence:String(n),id,eventId,hash,previousHash,cutoverId:cutover,inventory:Buffer.from(JSON.stringify(inventory)).toString('base64'),canonical:bytes.toString('base64') };
}
function sample() {
  const first = event(1,`GENESIS:v2:${cutover}:${scope}`);
  const second = event(2,first.hash!);
  const head: Head = { kind:'head',scope,sequence:'2',hash:second.hash!,cutoverId:cutover };
  return { first,second,head };
}

describe('snapshot v2 chain checks', () => {
  it('accepts a continuous chain and its matching head without claiming a full verdict', () => {
    const { first,second,head } = sample(); const scan = new SnapshotChain();
    [head,first,second].forEach(row => scan.accept(row));
    expect(scan.finish().heads.get(scope)).toEqual(head);
  });
  it('rejects missing, reordered and modified events', () => {
    const { first,second,head } = sample();
    expect(() => { const scan = new SnapshotChain(); scan.accept(head); scan.accept(second); }).toThrow();
    expect(() => { const scan = new SnapshotChain(); scan.accept(head); scan.accept(first); scan.finish(); }).toThrow();
    expect(() => { const scan = new SnapshotChain(); scan.accept({...first,canonical:Buffer.from('[]').toString('base64')}); }).toThrow();
  });
  it('rejects missing or altered head and duplicate events', () => {
    const { first,second,head } = sample();
    expect(() => { const scan = new SnapshotChain(); scan.accept(first); scan.accept(second); scan.finish(); }).toThrow();
    expect(() => { const scan = new SnapshotChain(); scan.accept({...head,sequence:'3'}); scan.accept(first); scan.accept(second); scan.finish(); }).toThrow();
    expect(() => { const scan = new SnapshotChain(); scan.accept(first); scan.accept(first); }).toThrow();
    expect(() => { const scan = new SnapshotChain(); scan.accept(first); scan.accept({...second,eventId:first.eventId}); }).toThrow();
  });
  it('rejects a changed inventory even when canonical bytes and chain hash match', () => {
    const { first } = sample(); const row = JSON.parse(Buffer.from(first.inventory,'base64').toString()); row[5] = 'changed';
    expect(() => new SnapshotChain().accept({...first,inventory:Buffer.from(JSON.stringify(row)).toString('base64')})).toThrow();
  });
});

describe('external preservation comparison', () => {
  function archiveFor(first: Event) {
    return { cutoverId:cutover, baselineRef:{name:'synthetic',generation:'1',size:'1',digest:'a'.repeat(64)}, v1Count:'0', v1Digest:sha256(Buffer.alloc(0)),
      positions:new Map([[scope,{sequence:'1',hash:first.hash!}]]),
      inventory:new Map([[`${scope}/1`,sha256(Buffer.from(first.inventory,'base64'))]]),
      latestComplete:'2026-01-01T00:00:00.000Z', ordinal:'1', manifestDigest:'a'.repeat(64) };
  }
  it('checks archived rows and reports newer rows as outside the archived boundary', async () => {
    const { comparePreservation } = await import('./preservation');
    const { first,second,head } = sample(); const scan = new SnapshotChain();
    [head,first,second].forEach(row => scan.accept(row));
    expect(comparePreservation(scan.finish(),archiveFor(first))).toMatchObject({archivedRows:'1',newerRows:'1',v1Count:'0'});
  });
  it('matches the v1 baseline digest and rejects a changed historical inventory', async () => {
    const { comparePreservation } = await import('./preservation');
    const { first,second,head } = sample();
    const legacy: Event = { kind:'v1',version:1,scope:'global',sequence:'0',id:'15200000-0000-4000-8000-000000000201',eventId:'15300000-0000-4000-8000-000000000201',hash:null,previousHash:null,cutoverId:null,canonical:null,inventory:'' };
    const row = ['audit-inventory:2',legacy.id,legacy.eventId,null,null,'synthetic','test',null,'success',null,null,null,'2026-01-01T00:00:00.000000Z',{},null,null,null,null,1,null,null,null];
    legacy.inventory = Buffer.from(JSON.stringify(row)).toString('base64');
    const digest = sha256(Buffer.concat([Buffer.from(sha256(Buffer.alloc(0)),'hex'),Buffer.from(JSON.stringify([legacy.id,sha256(Buffer.from(legacy.inventory,'base64'))]))]));
    const scan = new SnapshotChain(); [head,legacy,first,second].forEach(item => scan.accept(item));
    expect(comparePreservation(scan.finish(),{...archiveFor(first),v1Count:'1',v1Digest:digest}).v1Count).toBe('1');
    expect(() => comparePreservation(scan.finish(),{...archiveFor(first),v1Count:'1',v1Digest:'f'.repeat(64)})).toThrow();
  });
  it('rejects removed scopes, altered inventory and a different v1 baseline', async () => {
    const { comparePreservation } = await import('./preservation');
    const { first,second,head } = sample();
    const scan = new SnapshotChain(); [head,first,second].forEach(row => scan.accept(row));
    const archive = archiveFor(first);
    expect(() => comparePreservation(scan.finish(),{...archive,inventory:new Map([[`${scope}/1`,'f'.repeat(64)]])})).toThrow();
    expect(() => comparePreservation(scan.finish(),{...archive,v1Count:'1'})).toThrow();
    const missing = new SnapshotChain();
    expect(() => comparePreservation(missing.finish(),archive)).toThrow();
  });
});

describe('bounded snapshot pages', () => {
  it('checks every page and requires the cursor to match its last item', async () => {
    const { readSnapshotPages } = await import('./pages'); const { first,second,head } = sample();
    const headCursor = ['head',scope,'2','00000000-0000-0000-0000-000000000000'];
    const endCursor = ['v2',scope,'2',second.id];
    const pages = [ {items:[head],cursor:headCursor,more:true}, {items:[first,second],cursor:endCursor,more:false} ];
    const result = await readSnapshotPages(async () => pages.shift(), Date.now()+10000);
    expect(result.pages).toBe(2);
    expect(result.chain.finish().heads.get(scope)).toEqual(head);
    await expect(readSnapshotPages(async () => ({items:[head],cursor:endCursor,more:false}),Date.now()+10000)).rejects.toThrow();
  });
  it('rejects unfinished, repeated and oversized pages instead of declaring success', async () => {
    const { readSnapshotPages } = await import('./pages'); const { head } = sample();
    const cursor = ['head',scope,'2','00000000-0000-0000-0000-000000000000'];
    await expect(readSnapshotPages(async () => ({items:[],cursor:null,more:true}),Date.now()+10000)).rejects.toThrow();
    await expect(readSnapshotPages(async () => ({items:[head],cursor,more:true}),Date.now()+10000)).rejects.toThrow();
    const { first } = sample();
    await expect(readSnapshotPages(async () => ({items:[first,head],cursor,more:false}),Date.now()+10000)).rejects.toThrow();
    await expect(readSnapshotPages(async () => ({items:[],cursor:null,more:false,padding:'x'.repeat(1024*1024)}),Date.now()+10000)).rejects.toThrow();
    await expect(readSnapshotPages(async () => ({items:[],cursor:null,more:false}),0)).rejects.toMatchObject({category:'incomplete'});
  });
});

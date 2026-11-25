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

import { describe, expect, it } from 'vitest';
import type { Event } from '@/utils/auditArchive/contracts';
import { compareLegacyStructure } from './legacy';
import { LegacyGraph } from './legacyGraph';
const hash = (n:number) => String(n).padStart(64,'0');
function row(n:number,previous:string|null,current:string|null):Event {
  return { kind:'v1',version:1,scope:'global',sequence:'0',id:`15200000-0000-4000-8000-${String(n).padStart(12,'0')}`,
    eventId:`15300000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash:current,previousHash:previous,cutoverId:null,inventory:'',canonical:null };
}
describe('legacy link classification', () => {
  it('identifies null, invalid hash, missing references, branching, duplicate hashes and cycles', () => {
    const rows=[row(1,'GENESIS',hash(1)),row(2,'GENESIS',hash(2)),row(3,hash(1),hash(3)),row(4,hash(1),hash(4)),
      row(5,hash(8),hash(5)),row(6,hash(7),hash(6)),row(7,hash(6),hash(7)),row(8,null,hash(1)),row(9,'GENESIS','invalid')];
    const graph=new LegacyGraph(); rows.forEach(value => graph.accept(value)); const findings=graph.finish();
    expect(findings.get(rows[0].id)?.categories).toEqual(new Set(['duplicate_hash','multiple_genesis']));
    expect(findings.get(rows[2].id)?.categories).toEqual(new Set(['branch','ambiguous_reference']));
    expect(findings.get(rows[4].id)?.categories.has('missing_reference')).toBe(true);
    expect(findings.get(rows[5].id)?.categories.has('cycle')).toBe(true);
    expect(findings.get(rows[7].id)?.categories).toEqual(new Set(['null','duplicate_hash']));
    expect(findings.get(rows[8].id)?.categories.has('invalid_hash')).toBe(true);
  });
  it('requires the pinned classification to match each row, not only aggregate counts', () => {
    const graph=new LegacyGraph(); const a=row(1,null,null), b=row(2,'GENESIS',hash(2));
    graph.accept(a); graph.accept(b);
    const actual=graph.finish(), ids=graph.identities();
    const expected=new Map([[a.id,{scope:'global',categories:new Set(['null','unreproducible'])}],[b.id,{scope:'global',categories:new Set(['unreproducible'])}]]);
    expect(() => compareLegacyStructure(actual,expected,ids)).not.toThrow();
    expect(() => compareLegacyStructure(actual,new Map([[b.id,{scope:'global',categories:new Set(['null','unreproducible'])}]]),ids)).toThrow();
    expect(() => compareLegacyStructure(actual,new Map([['15500000-0000-4000-8000-000000000999',{scope:'global',categories:new Set(['unreproducible'])}]]),ids)).toThrow();
  });
});

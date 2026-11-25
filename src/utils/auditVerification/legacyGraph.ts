import { requireCondition, type Event } from '@/utils/auditArchive/contracts';

type Row = { id:string; scope:string; hash:string|null; previous:string|null };
type Finding = { scope:string; categories:Set<string> };

// Uses stored predecessor links; never infers a chain from timestamp or UUID.
// Hash recomputation is a separate evidence-backed operation.
export class LegacyGraph {
  private readonly rows = new Map<string,Row>();
  accept(event: Event) {
    requireCondition(event.kind === 'v1' && !this.rows.has(event.id));
    this.rows.set(event.id,{id:event.id,scope:event.scope,hash:event.hash,previous:event.previousHash});
  }
  identities() { return new Map([...this.rows].map(([id,row]) => [id,row.scope])); }
  recomputationRows() { return [...this.rows.values()].map(({id,hash}) => ({id,hash})); }
  finish() {
    const findings = new Map<string,Finding>();
    const groups = new Map<string,Row[]>();
    const add = (row:Row,category:string) => {
      const value=findings.get(row.id) ?? {scope:row.scope,categories:new Set<string>()};
      value.categories.add(category); findings.set(row.id,value);
    };
    for (const row of this.rows.values()) {
      const group=groups.get(row.scope) ?? []; group.push(row); groups.set(row.scope,group);
      if (row.hash === null || row.previous === null) add(row,'null');
      if (row.hash !== null && !/^[0-9a-f]{64}$/.test(row.hash)) add(row,'invalid_hash');
    }
    for (const group of groups.values()) {
      const hashes=new Map<string,Row[]>(), children=new Map<string,Row[]>();
      for (const row of group) {
        if (row.hash !== null) { const values=hashes.get(row.hash) ?? []; values.push(row); hashes.set(row.hash,values); }
        if (row.previous !== null) { const values=children.get(row.previous) ?? []; values.push(row); children.set(row.previous,values); }
      }
      for (const values of hashes.values()) if (values.length > 1) for (const row of values) add(row,'duplicate_hash');
      const roots=children.get('GENESIS') ?? [];
      if (roots.length > 1) for (const row of roots) add(row,'multiple_genesis');
      for (const [previous,values] of children) if (previous !== 'GENESIS' && values.length > 1) for (const row of values) add(row,'branch');
      const done=new Set<string>();
      for (const start of group) {
        const path:Row[]=[]; const positions=new Map<string,number>(); let current:Row|undefined=start;
        while (current && !done.has(current.id)) {
          const index=positions.get(current.id);
          if (index !== undefined) { for (const row of path.slice(index)) add(row,'cycle'); break; }
          positions.set(current.id,path.length); path.push(current);
          if (current.previous === null || current.previous === 'GENESIS') break;
          const parents:Row[]=hashes.get(current.previous) ?? [];
          if (parents.length !== 1) { add(current,parents.length ? 'ambiguous_reference' : 'missing_reference'); break; }
          current=parents[0];
        }
        for (const row of path) done.add(row.id);
      }
    }
    return findings;
  }
}

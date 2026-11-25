import { z } from 'zod';
import { ArchiveFailure, digest, requireCondition, type ObjectRef, type Store } from '@/utils/auditArchive/contracts';
import { readExactArchiveObject } from '@/utils/auditArchive/publisher';
import { withinDeadline } from './deadline';

const settingsSchema = z.strictObject({schema:z.literal('audit-v1-recompute-settings:1'),
  environment:z.enum(['local','staging','production']),cutoverId:z.uuid(),
  timeZone:z.string().min(1).max(128),dateStyle:z.string().regex(/^(ISO|SQL|Postgres|German), (MDY|DMY|YMD)$/),
  settingsEvidenceDigest:digest});
const responseSchema = z.array(z.strictObject({id:z.uuid(),hash:digest})).max(100);

type Row = {id:string;hash:string|null};
type Findings = Map<string,{scope:string;categories:Set<string>}>;
export type RecomputeSource = (run:string,ids:string[],timeZone:string,dateStyle:string) => Promise<unknown>;

// The operator pins this object independently of the database. Its evidence
// digest must match G's classification; this does not make historical v1 safe.
export async function recomputeLegacy(
  store:Store, pin:ObjectRef, environment:string, cutoverId:string, evidenceDigest:string,
  run:string, rows:Row[], findings:Findings, source:RecomputeSource, deadline:number,
) {
  requireCondition(pin.name === `control/${environment}/${cutoverId}/recompute-settings.json`);
  const object = await withinDeadline(() => readExactArchiveObject(store,pin),deadline);
  let settings: z.infer<typeof settingsSchema>;
  try { settings = settingsSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(object.bytes))); }
  catch { throw new ArchiveFailure('mismatch'); }
  requireCondition(settings.environment === environment && settings.cutoverId === cutoverId && settings.settingsEvidenceDigest === evidenceDigest);
  for (let index=0; index<rows.length; index+=100) {
    const batch=rows.slice(index,index+100);
    const raw=await withinDeadline(() => source(run,batch.map(row=>row.id),settings.timeZone,settings.dateStyle),deadline);
    const parsed=responseSchema.safeParse(raw);
    requireCondition(parsed.success && parsed.data.length === batch.length);
    for (let i=0; i<batch.length; i++) {
      const original=batch[i], computed=parsed.data[i];
      requireCondition(computed.id === original.id);
      const expectedMismatch=findings.get(original.id)?.categories.has('hash_mismatch') ?? false;
      requireCondition((computed.hash !== original.hash) === expectedMismatch);
    }
  }
  return { recomputedRows:rows.length.toString() };
}

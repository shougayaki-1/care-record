import { check, sha256 } from './cutover-inventory.mjs';

// JSON API preserves generation as decimal text (SDK7 coerces it to Number).
// Bound the entire response, use exact generations, never overwrite/delete.
export async function operatorStore(bucket,environment) {
  const { Storage }=await import('@google-cloud/storage');
  const storage=new Storage({ projectId:process.env.GCP_PROJECT_ID });
  async function request(url,init={}) {
    const auth=await storage.authClient.getRequestHeaders(url.toString());
    const headers=new Headers(init.headers);
    for (const [name,value] of Object.entries(auth)) headers.set(name,value);
    return fetch(url,{...init,headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});
  }
  async function body(response) {
    const reader=response.body?.getReader(); check(reader);
    const parts=[];let size=0;
    try { while(true) {const part=await reader.read();if(part.done) break;
      size+=part.value.length;check(size<=1024*1024);parts.push(part.value);}
    } finally {await reader.cancel();}
    return Buffer.concat(parts);
  }
  async function read(name,generation) {
    const url=new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`);
    if(generation) {check(/^[1-9][0-9]*$/.test(generation));url.searchParams.set('generation',generation);}
    const metadata=await request(url);if(metadata.status===404)return null;check(metadata.ok);
    const meta=JSON.parse((await body(metadata)).toString());
    check(typeof meta.generation==='string' && typeof meta.size==='string'
      && /^[1-9][0-9]*$/.test(meta.generation) && /^(0|[1-9][0-9]*)$/.test(meta.size)
      && BigInt(meta.size)<=1048576n && (!generation || generation===meta.generation));
    url.searchParams.set('generation',meta.generation);url.searchParams.set('alt','media');
    const response=await request(url);check(response.ok);
    const bytes=await body(response);check(String(bytes.length)===meta.size);
    return {bytes,ref:{name,generation:meta.generation,size:meta.size,digest:sha256(bytes)}};
  }
  return {read,async create(name,bytes) {
    check(name.startsWith(`control/${environment}/`) && bytes.length<=1024*1024);
    const url=new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    url.searchParams.set('uploadType','media');url.searchParams.set('name',name);url.searchParams.set('ifGenerationMatch','0');
    try {const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:bytes});
      check(response.ok || response.status===412);await body(response);
    } catch { /* Ambiguous result: reconcile exact bytes. */ }
    const saved=await read(name);check(saved && saved.bytes.equals(bytes));return saved;
  }};
}

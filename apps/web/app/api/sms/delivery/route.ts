import { internalApi } from '@/lib/server/internal-api';

/** Public prepared callback bridge. Fastify authenticates the provider credential. */
export async function POST(req: Request) {
  const body=await req.text();
  if(Buffer.byteLength(body)>4096)return new Response(null,{status:413});
  try {
    const r=await internalApi('/v1/webhooks/46elks',{token:null,method:'POST',body,headers:{authorization:req.headers.get('authorization')??'','content-type':req.headers.get('content-type')??''},signal:AbortSignal.timeout(10000)});
    return new Response(null,{status:r.status,headers:{'cache-control':'no-store'}});
  } catch { return new Response(null,{status:503}); }
}

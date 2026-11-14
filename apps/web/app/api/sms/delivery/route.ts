import { internalApi } from '@/lib/server/internal-api';
import { readBoundedText, RequestBodyTimeout, RequestBodyTooLarge } from '@/lib/server/request-security';

/** Public prepared callback bridge. Fastify authenticates the provider credential. */
export async function POST(req: Request) {
  try {
    const body=await readBoundedText(req,4096);
    const r=await internalApi('/v1/webhooks/46elks',{token:null,method:'POST',body,headers:{authorization:req.headers.get('authorization')??'','content-type':req.headers.get('content-type')??''},signal:AbortSignal.timeout(10000)});
    return new Response(null,{status:r.status,headers:{'cache-control':'no-store'}});
  } catch (err) { return new Response(null,{status:err instanceof RequestBodyTooLarge ? 413 : err instanceof RequestBodyTimeout ? 408 : 503}); }
}

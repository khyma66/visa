import type { BrowserContext } from '@playwright/test';
import { requestDecision, readRpcUrl, LIMITS, ORIGIN } from './policy.mjs';

export type Audit = { documents: number; readRpcGets: number; suppressedViews: number; blockedWrites: number; blockedOther: number; redirects: number; requests: number; statuses: number[] };
export const emptyAudit = (): Audit => ({ documents:0, readRpcGets:0, suppressedViews:0, blockedWrites:0, blockedOther:0, redirects:0, requests:0, statuses:[] });

export async function installReadOnlyGuard(context: BrowserContext, posts: {url:string}[], audit: Audit, origin = ORIGIN) {
  // Service workers are disabled when the context is created. No auth state,
  // session tokens, proxy rotation, or security-challenge handling is installed.
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    const action = requestDecision({url:request.url(), method:request.method(), resourceType:request.resourceType()},posts,origin);
    if (++audit.requests > LIMITS.requests) { audit.blockedOther++; await route.abort('blockedbyclient'); return; }
    if (action === 'suppress-view') {
      audit.suppressedViews++;
      // Local acknowledgement only: never forward a synthetic counting POST.
      await route.fulfill({status:202,contentType:'application/json',body:'[]',headers:{'Cache-Control':'no-store'}}); return;
    }
    if (action === 'deny-write') { audit.blockedWrites++; await route.abort('blockedbyclient'); return; }
    if (action === 'deny') { audit.blockedOther++; await route.abort('blockedbyclient'); return; }
    if (action === 'document') {
      if (audit.documents >= LIMITS.visits) { audit.blockedOther++; await route.abort('blockedbyclient'); return; }
      audit.documents++;
    }
    try {
      // No automatic redirect hop can escape the origin/path allowlist.
      let response;
      if(action==='rpc-read'){
        const target=readRpcUrl(request.url(),request.postData());
        const headers={...request.headers()};
        for(const key of ['content-type','content-length','transfer-encoding'])delete headers[key];
        // GET runs under PostgREST's read-only transaction mode. No POST or
        // original request body is forwarded, and redirects remain disabled.
        response=await context.request.get(target,{headers,maxRedirects:0,timeout:15_000});
        audit.readRpcGets++;
      }else response=await route.fetch({maxRedirects:0,timeout:15_000});
      const status = response.status();
      if (audit.statuses.length < 50 && status >= 400) audit.statuses.push(status);
      if (status >= 300 && status < 400) { audit.redirects++; await route.abort('blockedbyclient'); return; }
      await route.fulfill({response});
    } catch { await route.abort('failed'); }
  });
}

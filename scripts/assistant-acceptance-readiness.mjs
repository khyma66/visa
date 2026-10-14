import assert from 'node:assert/strict';

// Only the inference-free readiness operation is retried. Test inference itself
// is never retried, so a failing model response cannot become a hidden pass.
export async function waitForAcceptanceReady(url, secret, sourceSha, cases, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = now() + 45_000;
  let lastStatus = 'unavailable';
  let attempt = 0;
  let consecutive = 0;
  while (now() < deadline) {
    try {
      // A unique query prevents an earlier platform 404 cached during route
      // creation from masquerading as the newly deployed endpoint. Once both
      // proofs pass, inference uses this exact same URL, method, and route.
      const candidate = new URL(url);
      candidate.searchParams.set('readiness', String(attempt++));
      const init = { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: JSON.stringify({ id: '__ready__' }), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))) };
      const reply = await fetcher(candidate, init);
      lastStatus = String(reply.status);
      if (reply.ok && reply.headers.get('X-Assistant-Acceptance') === 'v1') {
        const result = await reply.json();
        if (result.ready === true && result.protocol === 'visathreads-assistant-acceptance-v1' && result.sourceSha === sourceSha && result.model === '@cf/qwen/qwen3-30b-a3b-fp8' && JSON.stringify(result.cases) === JSON.stringify(cases)) {
          const rejected = await fetcher(candidate, { ...init, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))) });
          const provenRejection = rejected.status === 404 && rejected.headers.get('X-Assistant-Acceptance') === 'v1';
          await rejected.body?.cancel();
          if (provenRejection) {
            consecutive++;
            if (consecutive >= 4) return candidate;
            lastStatus = 'awaiting-stable-propagation';
          } else {
            consecutive = 0;
            lastStatus = 'unproven-authentication-rejection';
          }
        } else { consecutive = 0; lastStatus = 'content-mismatch'; }
      } else { consecutive = 0; await reply.body?.cancel(); }
    } catch { consecutive = 0; lastStatus = 'network-unavailable'; }
    if (now() < deadline) await pause(Math.min(2000, deadline - now()));
  }
  assert.fail(`Authenticated evaluation Worker readiness failed (${lastStatus}); no model cases were invoked`);
}

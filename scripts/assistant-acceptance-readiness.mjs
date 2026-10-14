import assert from 'node:assert/strict';

// Only the inference-free readiness endpoint is retried. Test inference itself
// is never retried, so a failing model response cannot become a hidden pass.
export async function waitForAcceptanceReady(url, secret, sourceSha, cases, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = now() + 45_000;
  let lastStatus = 'unavailable';
  while (now() < deadline) {
    try {
      const reply = await fetcher(url, { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))) });
      lastStatus = String(reply.status);
      if (reply.ok && reply.headers.get('X-Assistant-Acceptance') === 'v1') {
        const result = await reply.json();
        if (result.ready === true && result.protocol === 'visathreads-assistant-acceptance-v1' && result.sourceSha === sourceSha && result.model === '@cf/qwen/qwen3-30b-a3b-fp8' && JSON.stringify(result.cases) === JSON.stringify(cases)) return;
        lastStatus = 'content-mismatch';
      } else await reply.body?.cancel();
    } catch { lastStatus = 'network-unavailable'; }
    if (now() < deadline) await pause(Math.min(2000, deadline - now()));
  }
  assert.fail(`Authenticated evaluation Worker readiness failed (${lastStatus}); no model cases were invoked`);
}

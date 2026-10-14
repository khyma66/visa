// Failed hosted responses are retained only from our fixed-fixture evaluation
// Worker. Do not save platform pages, credentials, or arbitrary error messages.
export async function readAcceptanceFailureDiagnostic(reply, id, model) {
  if (reply.headers.get('X-Assistant-Acceptance') !== 'v1' || !reply.body) {
    await reply.body?.cancel();
    return undefined;
  }
  const reader = reply.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 100_000) return undefined;
      body += decoder.decode(value, { stream: true });
    }
    const value = JSON.parse(body + decoder.decode());
    const diagnostic = value.syntheticDiagnostic;
    if (value.id !== id || value.model !== model || value.passed !== false
      || diagnostic?.source !== 'compiled-synthetic-fixture-only'
      || diagnostic.fixtureId !== id || diagnostic.stage !== 'source-validation') return undefined;
    return diagnostic;
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Failed hosted responses are retained only from our fixed-fixture evaluation
// Worker. Do not save platform pages, credentials, or arbitrary error messages.
const serviceStages = new Set(['request', 'authentication', 'retrieval', 'quota', 'generation', 'validation', 'revalidation']);
const providerReasons = new Set(['missing_binding', 'missing_key', 'timeout', 'cancelled', 'provider_error', 'incomplete_output', 'empty_output', 'oversized_output']);
const validationCodes = new Set(['output_json', 'output_schema', 'claim_limit', 'claim_text', 'citation_missing', 'citation_schema', 'citation_length', 'citation_source', 'citation_quote', 'conflict_sources', 'unanswered_limit', 'answered_without_claims']);

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
      || diagnostic.fixtureId !== id || !['source-validation', 'application-service'].includes(diagnostic.stage)) return undefined;
    const result = { source: diagnostic.source, fixtureId: id, stage: diagnostic.stage };
    if (diagnostic.serviceFailure !== undefined) {
      const failure = diagnostic.serviceFailure;
      if (!serviceStages.has(failure?.stage) || !Number.isInteger(failure.status) || failure.status < 500 || failure.status > 599
        || (failure.code !== undefined && !validationCodes.has(failure.code))) return undefined;
      result.serviceFailure = { stage: failure.stage, status: failure.status, ...(failure.code ? { code: failure.code } : {}) };
    }
    if (diagnostic.providerReason !== undefined) {
      if (!providerReasons.has(diagnostic.providerReason)) return undefined;
      result.providerReason = diagnostic.providerReason;
    }
    // Only a failed model response to compiled synthetic evidence may retain
    // model output. Provider/service failures contain fixed metadata only.
    if (diagnostic.stage === 'source-validation') {
      if (diagnostic.output !== undefined) result.output = diagnostic.output;
      else if (typeof diagnostic.rawOutput === 'string' && diagnostic.rawOutput.length <= 24_000) result.rawOutput = diagnostic.rawOutput;
      else return undefined;
    } else if (!result.serviceFailure && !result.providerReason) return undefined;
    return result;
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

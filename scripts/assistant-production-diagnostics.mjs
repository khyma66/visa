// Read-only incident inspection: no Worker/config mutations, no stored raw events.
// Cloudflare query uses POST but dry:true prevents persistence of query results.
const WORKER = 'visaflow-dev';
const timeframe = {
  from: Date.parse('2026-10-15T01:05:00Z'),
  to: Date.parse('2026-10-15T01:09:00Z'),
};
const emit = (value) => console.log(JSON.stringify(value));
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const exceptionNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'TimeoutError', 'AiError', 'AIError', 'AssistantError']);
const outcomes = new Set(['ok', 'exception', 'exceededCpu', 'exceededMemory', 'canceled', 'unknown', 'scriptNotFound', 'responseStreamDisconnected']);
const allowedKeys = new Set([
  '$metadata.service', '$metadata.statusCode', '$metadata.duration', '$metadata.error',
  '$metadata.trigger', '$metadata.type', '$metadata.origin', '$metadata.level',
  '$workers.outcome', '$workers.wallTimeMs', '$workers.cpuTimeMs',
  '$workers.event.response.status', '$workers.event.request.method',
]);

async function readTelemetry(endpoint, input) {
  if (!['keys', 'query'].includes(endpoint)) throw new Error('Unexpected diagnostic endpoint');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Production read credentials unavailable');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/observability/telemetry/${endpoint}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Diagnostic response exceeded safe size');
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Telemetry ${endpoint} returned non-JSON HTTP ${response.status}`); }
  if (!response.ok || body.success === false) {
    emit({ endpoint, httpStatus: response.status, errorCodes: (body.errors ?? []).map((error) => error.code).filter(Number.isInteger).slice(0, 8) });
    throw new Error(response.status === 401 || response.status === 403 ? 'Existing credential cannot read Workers telemetry' : `Telemetry ${endpoint} query failed`);
  }
  return body.result;
}

function safeEvent(event) {
  const metadata = event?.$metadata ?? {};
  const source = event?.source && typeof event.source === 'object' ? event.source : {};
  const worker = source.$workers ?? event?.$workers ?? {};
  const exception = source.exception ?? source.error ?? worker.exception;
  const exceptionName = typeof exception === 'object' ? exception?.name : undefined;
  const recognizedError = typeof metadata.error === 'string' ? metadata.error.match(/^(Error|TypeError|RangeError|SyntaxError|ReferenceError|AbortError|TimeoutError|AiError|AIError|AssistantError)(?::|$)/)?.[1] : undefined;
  return {
    timestamp: number(event.timestamp),
    status: number(metadata.statusCode ?? worker.event?.response?.status),
    durationMs: number(metadata.duration ?? worker.wallTimeMs),
    cpuTimeMs: number(worker.cpuTimeMs),
    outcome: outcomes.has(worker.outcome) ? worker.outcome : null,
    exceptionClass: exceptionNames.has(exceptionName) ? exceptionName : recognizedError ?? null,
    hasError: Boolean(metadata.error || exception),
  };
}

try {
  const filters = [{ key: '$metadata.service', operation: 'eq', type: 'string', value: WORKER }];
  const keys = await readTelemetry('keys', { ...timeframe, filters, limit: 1000 });
  const discovered = Array.isArray(keys) ? keys : [];
  emit({ worker: WORKER, timeframe, availableSafeKeys: discovered.filter((entry) => allowedKeys.has(entry.key)).map(({ key, type }) => ({ key, type })) });
  if (!discovered.some((entry) => entry.key === '$metadata.service')) throw new Error('Worker telemetry service field unavailable in incident window');
  const result = await readTelemetry('query', {
    queryId: 'assistant-incident-20261015-readonly', timeframe, dry: true, limit: 100, view: 'events',
    parameters: { filters, filterCombination: 'and', needle: { value: '/api/assistant', isRegex: false, matchCase: true } },
  });
  const events = result?.events?.events ?? [];
  emit({ eventsViewReturned: Boolean(result?.events), matchedEventCount: number(result?.events?.count), returnedEvents: events.length, events: events.slice(0, 100).map(safeEvent) });
} catch (error) {
  // Only locally defined error messages are safe; fetch errors may include URLs.
  const known = typeof error?.message === 'string' && /^(Unexpected diagnostic endpoint|Production read credentials unavailable|Diagnostic response exceeded safe size|Telemetry (keys|query) (returned non-JSON HTTP \d+|query failed)|Existing credential cannot read Workers telemetry|Worker telemetry service field unavailable in incident window)$/.test(error.message);
  emit({ diagnosticFailure: known ? error.message : 'Diagnostic transport failed without exposing provider response' });
  process.exitCode = 1;
}

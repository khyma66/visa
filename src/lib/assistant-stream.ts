import type { AssistantFailureStage } from './assistant-service';

type Handler = (request: Request, progress?: (stage: AssistantFailureStage) => void) => Promise<Response>;

/** Progress is streamed immediately; evidence-backed answer text is released only after review and fresh authorization. */
export function streamAssistantResponse(request: Request, handle: Handler): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal]);
  const forwarded = new Request(request, { signal });
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (value: unknown) => { if (!closed && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      // Keep start synchronous so reader cancellation can abort a running handler.
      void (async () => {
      try {
        emit({ type: 'progress', stage: 'request' });
        const response = await handle(forwarded, stage => emit({ type: 'progress', stage }));
        const value = await response.json();
        emit({ type: 'complete', status: response.status, value, retryAfter: response.headers.get('Retry-After') });
      } catch {
        emit({ type: 'complete', status: 503, value: { code: 'unavailable' }, retryAfter: null });
      } finally {
        if (!closed) { closed = true; controller.close(); }
      }
      })();
    },
    cancel() { closed = true; cancelled.abort(); },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Accept' } });
}

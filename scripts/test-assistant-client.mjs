import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const code = ts.transpileModule(await readFile(new URL('../src/lib/assistant-client.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
assert.doesNotMatch(code, /supabase|assistant-service|assistant-provider|assistant-data/);
const { parseAssistantResult, parseAssistantFailure, assistantFailureMessage, readAssistantJson, safeAssistantHref } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const fixture = () => ({
  status: 'answered', claims: [{ text: 'A member reported a document request.', evidence: [{ sourceId: 'a:reply-one', quote: 'They asked for documents.' }] }], disagreements: [], unanswered: [],
  sources: [{ id: 'a:reply-one', kind: 'reply', questionId: 'apify-one', communityId: null, title: 'Appointment report', body: 'They asked for documents.',
    createdAt: '2026-10-01T10:00:00+00:00', updatedAt: '2026-10-02T10:00:00.123Z', url: '/questions/apify-one#answer-reply-one', provenance: 'archive', parentContext: 'Which documents?', parentUpdatedAt: '2026-10-01T10:00:00Z', speakerRole: 'original-poster' }],
  coverage: { sourceCount: 2, partial: true, reasons: ['missing-replies'], since: '2026-10-01T00:00:00Z', until: '2026-10-03T00:00:00Z' },
  generatedAt: '2026-10-03T00:00:00.000Z', cached: false, notice: 'Community experiences, not official visa advice.',
});

test('valid nested responses become independent allowlisted objects with safe evidence and dates', () => {
  const input = fixture(); input.debug = 'private exception'; input.sources[0].email = 'private@example.test'; input.claims[0].rawPrompt = 'private prompt';
  const result = parseAssistantResult(input);
  assert(result); assert.notEqual(result, input); assert.notEqual(result.sources[0], input.sources[0]); assert.notEqual(result.claims[0].evidence[0], input.claims[0].evidence[0]);
  assert.doesNotMatch(JSON.stringify(result), /private|rawPrompt|debug|email/);
  assert.equal(result.sources[0].speakerRole, 'original-poster'); assert.equal(result.coverage.sourceCount, 2);
});

test('source bodies through the server 24k summary limit survive parsing without loosening other nested checks', async () => {
  for (const length of [12_000, 12_001, 16_000, 23_999, 24_000]) {
    const input = fixture();
    input.sources[0].body += 'x'.repeat(length - input.sources[0].body.length);
    const result = parseAssistantResult(await readAssistantJson(Response.json(input)));
    assert(result, `A valid ${length}-character cited source must remain displayable`);
    assert.equal(result.sources[0].body, input.sources[0].body);
    assert.deepEqual(result.claims, input.claims); assert.equal(result.sources[0].url, input.sources[0].url);
  }
  for (const length of [24_001, 48_000]) {
    const input = fixture(); input.sources[0].body = 'x'.repeat(length);
    assert.equal(parseAssistantResult(input), null, `Source body ${length} exceeds the server cap`);
  }
  const long = fixture(); long.sources[0].body = 'x'.repeat(24_000);
  for (const mutate of [value => { value.sources[0].createdAt = 'invalid'; }, value => { value.sources[0].parentContext = 'x'.repeat(2001); }, value => { value.claims[0].evidence[0].sourceId = 'a:unknown'; }]) {
    const input = structuredClone(long); mutate(input); assert.equal(parseAssistantResult(input), null);
  }
  long.sources[0].url = 'https://untrusted.example/report';
  assert.equal(parseAssistantResult(long)?.sources[0].url, '', 'Long sources never bypass navigation restrictions');
});

test('multiple individually allowed long sources still obey the unchanged 256KB response ceiling', async () => {
  const input = fixture();
  input.sources = Array.from({ length: 11 }, (_, index) => ({ ...input.sources[0], id: index ? `a:reply-${index}` : input.sources[0].id, body: 'x'.repeat(24_000) }));
  input.coverage.sourceCount = input.sources.length;
  assert.equal(parseAssistantResult(input)?.sources.length, 11, 'Per-source structural validation is separate from the byte reader');
  const raw = JSON.stringify(input); assert(new TextEncoder().encode(raw).byteLength > 256_000);
  await assert.rejects(readAssistantJson(new Response(raw)), /exceeds limit/);
});

test('malformed deeply nested success payloads are rejected before rendering', () => {
  const mutations = [
    v => { v.status = { toString: null }; }, v => { v.claims = null; }, v => { v.claims[0] = null; },
    v => { v.claims[0].text = {}; }, v => { v.claims[0].text = ' '; }, v => { v.claims[0].text = 'x'.repeat(701); },
    v => { v.claims[0].evidence = null; }, v => { v.claims[0].evidence = [null]; }, v => { v.claims[0].evidence = []; },
    v => { v.claims[0].evidence[0].quote = 1; }, v => { v.claims[0].evidence[0].quote = 'short'; },
    v => { v.claims[0].evidence[0].sourceId = 'a:missing'; }, v => { v.claims = []; },
    v => { v.sources = [null]; }, v => { v.sources[0].kind = { toString: null }; }, v => { v.sources[0].provenance = {}; },
    v => { v.sources[0].body = {}; }, v => { v.sources[0].body = 'x'.repeat(24001); }, v => { v.sources[0].title = []; },
    v => { v.sources[0].id = 'javascript:alert(1)'; }, v => { v.sources[0].communityId = {}; }, v => { v.sources[0].url = null; },
    v => { v.sources[0].createdAt = 'yesterday'; }, v => { v.sources[0].updatedAt = null; },
    v => { v.sources[0].parentContext = []; }, v => { v.sources[0].parentUpdatedAt = 'bad'; }, v => { v.sources[0].speakerRole = 'official'; },
    v => { v.sources.push(v.sources[0]); }, v => { v.coverage = null; }, v => { v.coverage.sourceCount = -1; },
    v => { v.coverage.sourceCount = 0; }, v => { v.coverage.sourceCount = '1'; }, v => { v.coverage.sourceCount = 49; },
    v => { v.coverage.partial = 'false'; }, v => { v.coverage.reasons = [null]; }, v => { v.coverage.reasons = ['untrusted-reason']; },
    v => { v.coverage.since = 'bad'; }, v => { delete v.coverage.until; }, v => { v.coverage.until = v.coverage.since; },
    v => { v.unanswered = [null]; }, v => { v.unanswered = Array(5).fill('Question'); },
    v => { v.notice = {}; }, v => { v.generatedAt = 'invalid'; }, v => { v.cached = 'false'; },
    v => { v.disagreements = [{ ...v.claims[0], evidence: [v.claims[0].evidence[0], v.claims[0].evidence[0]] }]; },
    v => { v.kind = 'posts'; v.posts = [{ questionId: 'apify-one' }]; },
  ];
  for (const [index, mutate] of mutations.entries()) { const input = fixture(); mutate(input); assert.equal(parseAssistantResult(input), null, `Malformed nested case ${index}`); }
  for (const input of [null, false, 'answer', [], 1]) assert.equal(parseAssistantResult(input), null);
});

test('insufficient answers cannot leak claims and unsafe links never navigate', () => {
  const input = fixture(); input.status = 'insufficient'; input.sources[0].url = 'javascript:alert(1)';
  const result = parseAssistantResult(input); assert(result);
  assert.deepEqual(result.claims, []); assert.deepEqual(result.disagreements, []); assert.equal(result.sources[0].url, '');
  for (const url of ['https://external.test', '//external.test', '/questions/../messages', '/questions/%2fsecret', '/questions/post?token=private', 'javascript:alert(1)']) assert.equal(safeAssistantHref(url), false);
  assert.equal(safeAssistantHref('/experiences/post-one#answer-reply-one'), true);
});

test('post matches validate every nested field while dropping unsafe and duplicate navigation', () => {
  const post = { questionId: 'apify-one', sourceId: 'q:apify-one', title: 'Appointment report', excerpt: 'Posted yesterday.', url: '/questions/apify-one', createdAt: '2026-10-01T10:00:00Z' };
  const input = { ...fixture(), kind: 'posts', claims: [], sources: [], posts: [post, { ...post }, { ...post, questionId: 'unsafe', url: '//external.test' }] };
  assert.deepEqual(parseAssistantResult(input)?.posts, [post]);
  for (const key of ['questionId', 'sourceId', 'title', 'excerpt', 'url', 'createdAt']) assert.equal(parseAssistantResult({ ...input, posts: [{ ...post, [key]: null }] }), null, key);
  const empty = parseAssistantResult({ ...input, status: 'insufficient', posts: [], coverage: { sourceCount: 0, partial: false, since: '2026-09-17T00:00:00Z', until: '2026-10-17T00:00:00Z' }, unanswered: ['No matching posts were published in this time range.'] });
  assert(empty); assert.equal(empty.coverage.since, '2026-09-17T00:00:00Z'); assert.equal(empty.posts.length, 0);
});

test('typed failure codes match status and ignore raw errors and unbounded retry metadata', () => {
  const now = Date.parse('2026-10-17T12:00:00.000Z'), requestId = 'c6ac6e65-7aac-4926-bdf2-1ae13ddd6c48';
  const result = parseAssistantFailure(429, { code: 'quota', requestId, error: 'private provider prompt', retryAfterSeconds: 300, resetAt: '2026-10-18T00:00:00.000Z', quotaReason: 'user_daily_limit' }, null, now);
  assert.deepEqual(result, { code: 'quota', requestId, retryAfterSeconds: 300, resetAt: '2026-10-18T00:00:00.000Z' });
  assert.match(assistantFailureMessage(result), /Available again after 2026-10-18 00:00 UTC/);
  assert.doesNotMatch(assistantFailureMessage(result), /provider|prompt|user_daily_limit/);
  assert.equal(parseAssistantFailure(401, { code: 'quota', requestId: '<script>', resetAt: '2026-10-18T00:00:00.000Z' }, '300', now).code, 'authentication');
  assert.equal(parseAssistantFailure(503, { code: 'toString' }).code, 'unavailable');
  assert.equal(parseAssistantFailure(502, { code: 'unavailable' }).code, 'unavailable');
  for (const retryAfterSeconds of [-1, 0, 86401, Infinity, '60', {}, 1.5]) assert.equal(parseAssistantFailure(429, { code: 'rate_limit', retryAfterSeconds }, null, now).retryAfterSeconds, undefined);
  for (const resetAt of ['yesterday', '2026-10-17T00:00:00.000Z', '2026-10-19T00:00:00.000Z', '2026-10-18T00:00:00+00:00']) assert.equal(parseAssistantFailure(429, { code: 'quota', resetAt }, null, now).resetAt, undefined);
  assert.match(assistantFailureMessage(parseAssistantFailure(429, null, '61')), /2 minutes/);
  assert.equal(parseAssistantFailure(429, null, '9999999999').retryAfterSeconds, undefined);
  for (const [status, code] of [[400, 'invalid_request'], [401, 'authentication'], [403, 'permission'], [409, 'source_changed'], [429, 'rate_limit'], [499, 'cancelled'], [502, 'source_verification'], [503, 'unavailable'], [504, 'timeout'], [418, 'unavailable']]) {
    const failure = parseAssistantFailure(status, { error: 'private sentinel' }); assert.equal(failure.code, code); assert.doesNotMatch(assistantFailureMessage(failure), /private|sentinel/);
  }
});

test('bounded JSON reader handles valid streaming data, HTML failures, declared and actual overflow', async () => {
  assert.deepEqual(await readAssistantJson(Response.json({ okay: '文档' })), { okay: '文档' });
  await assert.rejects(readAssistantJson(new Response('<html>proxy failure</html>')));
  await assert.rejects(readAssistantJson(new Response('{}', { headers: { 'content-length': '256001' } })), /exceeds limit/);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(256001))); }, cancel() { cancelled = true; } });
  await assert.rejects(readAssistantJson(new Response(body)), /exceeds limit/); assert.equal(cancelled, true);
  const controller = new AbortController();
  const aborted = new ReadableStream({ start(stream) { controller.signal.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError'))); } });
  const pending = readAssistantJson(new Response(aborted)); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

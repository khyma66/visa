import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/analytics-server.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { authorizedAnalytics, summarizeImport, sanitizeOwnerAnalytics } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const config = { url: 'https://database.example', key: 'public-test-key' };
const bearer = `Bearer ${'a'.repeat(40)}`;
const request = (search = '', authorization = bearer) => new Request(`https://visathreads.com/api/admin/analytics${search}`, { headers: { Authorization: authorization } });
const emptyActivity = () => ({ members_joined: 0, questions_created: 0, experiences_created: 0, answers_created: 0, imported_replies_created: 0, distinct_contributors: 0 });
function validMetrics(days = 7) {
  const end = '2026-10-16T12:00:00.000Z';
  const startMs = Date.parse('2026-10-16T00:00:00.000Z') - (days - 1) * 86_400_000;
  return {
    schema_version: 1, generated_at: end,
    window: { days, start_inclusive: new Date(startMs).toISOString(), end_exclusive: end, timezone: 'UTC', includes_partial_today: true },
    overview: emptyActivity(),
    quality: { questions_in_window: 0, questions_with_human_answer: 0, answer_rate_percent: null, median_first_answer_hours: null, unanswered_questions_current: 0 },
    operations: { reports_received: 0, reports_pending_current: 0, feedback_received: 0, feedback_pending_current: 0 },
    daily: Array.from({ length: days }, (_, index) => ({ date: new Date(startMs + index * 86_400_000).toISOString().slice(0, 10), ...emptyActivity() })),
    limitations: ['Current retained records, not an immutable event history.'],
  };
}

test('anonymous and malformed requests cannot contact database or read summaries', async () => {
  for (const value of ['', 'Bearer null', `Bearer ${'x'.repeat(8200)}`]) {
    const result = await authorizedAnalytics(request('', value), config, () => { throw new Error('Must not fetch'); });
    assert.equal(result.response.status, 401);
    assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
  }
});
test('report windows are strictly bounded and unknown query parameters rejected', async () => {
  for (const search of ['?days=365', '?days=30&days=7', '?days=7&user=other', '?days=7.0']) {
    const result = await authorizedAnalytics(request(search), config, () => { throw new Error('Must not fetch'); });
    assert.equal(result.response.status, 400);
  }
});
test('verified caller JWT reaches owner-gated RPC, not service credentials', async () => {
  const calls = [];
  const metrics = validMetrics();
  const result = await authorizedAnalytics(request('?days=7'), config, async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, bearer); assert.equal(options.headers.apikey, config.key);
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    if (url.endsWith('/user')) return Response.json({ id: 'test-owner', is_anonymous: false });
    assert.deepEqual(JSON.parse(options.body), { period_days: 7 });
    return Response.json(metrics);
  });
  assert.deepEqual(calls, ['https://database.example/auth/v1/user', 'https://database.example/rest/v1/rpc/owner_analytics']);
  assert.deepEqual(result.metrics, metrics);
});
test('full aggregate contracts accept real zero counts and nullable unavailable measurements', () => {
  for (const days of [7, 30, 90]) assert.deepEqual(sanitizeOwnerAnalytics(validMetrics(days), days), validMetrics(days));
  const answered = validMetrics();
  answered.overview.questions_created = answered.daily[0].questions_created = 2;
  answered.quality = { questions_in_window: 2, questions_with_human_answer: 1, answer_rate_percent: 50, median_first_answer_hours: 0, unanswered_questions_current: 1 };
  assert.deepEqual(sanitizeOwnerAnalytics(answered, 7), answered);
  const postgres = validMetrics();
  postgres.generated_at = postgres.window.end_exclusive = '2026-10-16T12:00:00.123456+00:00';
  postgres.window.start_inclusive = '2026-10-10T00:00:00+00:00';
  assert.equal(sanitizeOwnerAnalytics(postgres, 7).generated_at, '2026-10-16T12:00:00.123Z');
});
test('malformed version-one shapes, numbers, windows and oversized arrays fail closed', async () => {
  const changes = [
    value => { delete value.window; }, value => { value.overview = []; },
    value => { value.window.days = 30; }, value => { value.window.timezone = 'America/Chicago'; },
    value => { value.window.includes_partial_today = 'true'; }, value => { value.window.start_inclusive = '2026-02-30T00:00:00Z'; },
    value => { value.generated_at = 'bad'; }, value => { value.window.end_exclusive = '2026-10-17T12:00:00Z'; },
    value => { value.daily.push(value.daily[0]); }, value => { value.daily = []; },
    value => { value.daily[0].date = '2026-10-09'; }, value => { value.daily[1].date = value.daily[0].date; },
    value => { value.daily[0].answers_created = -1; }, value => { value.overview.members_joined = 1; },
    value => { value.quality.questions_with_human_answer = 1; }, value => { value.quality.answer_rate_percent = 101; },
    value => { value.quality.answer_rate_percent = 0; }, value => { value.quality.median_first_answer_hours = -1; },
    value => { value.operations.feedback_received = null; }, value => { value.operations.reports_received = '1'; },
    value => { value.limitations = Array(21).fill('too many'); }, value => { value.limitations = []; },
    value => { value.limitations = ['x'.repeat(1001)]; }, value => { value.limitations = [1]; },
  ];
  for (const change of changes) {
    const metrics = validMetrics(); change(metrics);
    assert.throws(() => sanitizeOwnerAnalytics(metrics, 7), /Invalid analytics contract/);
    const result = await authorizedAnalytics(request('?days=7'), config, async url => Response.json(url.endsWith('/user') ? { id: 'owner' } : metrics));
    assert.equal(result.response.status, 503); assert(!('metrics' in result));
  }
  for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['members_joined', 'questions_created', 'experiences_created', 'answers_created', 'imported_replies_created', 'distinct_contributors']) {
      const metrics = validMetrics(); metrics.overview[field] = value;
      assert.throws(() => sanitizeOwnerAnalytics(metrics, 7), /Invalid analytics contract/);
    }
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const field of ['answer_rate_percent', 'median_first_answer_hours']) {
      const metrics = validMetrics(); metrics.quality[field] = value;
      assert.throws(() => sanitizeOwnerAnalytics(metrics, 7), /Invalid analytics contract/);
    }
  }
  for (const value of [null, [], {}, { schema_version: 1 }]) assert.throws(() => sanitizeOwnerAnalytics(value, 7), /Invalid analytics contract/);
});
test('unknown fields are removed at every level before report data leaves the server', async () => {
  const expected = validMetrics();
  const upstream = structuredClone(expected);
  for (const object of [upstream, upstream.window, upstream.overview, upstream.quality, upstream.operations, ...upstream.daily]) object.private_content = 'must never leave the server';
  const result = await authorizedAnalytics(request('?days=7'), config, async url => Response.json(url.endsWith('/user') ? { id: 'owner' } : upstream));
  assert.deepEqual(result.metrics, expected);
  assert(!JSON.stringify(result.metrics).includes('private_content'));
  assert.equal(upstream.private_content, 'must never leave the server');
});
test('expired identity and non-owner cannot read analytics; upstream error detail is hidden', async () => {
  let calls = 0;
  let result = await authorizedAnalytics(request(), config, async () => { calls++; return Response.json({ secret: 'do-not-return' }, { status: 401 }); });
  assert.equal(calls, 1); assert.equal(result.response.status, 401);
  result = await authorizedAnalytics(request(), config, async url => url.endsWith('/user') ? Response.json({ id: 'normal-user' }) : Response.json({ message: 'private internals' }, { status: 403 }));
  assert.equal(result.response.status, 403); assert(!JSON.stringify(await result.response.json()).includes('private internals'));
});
test('backend errors never become false zero counts; large bodies fail closed', async () => {
  for (const mode of ['network', 'large', 'schema']) {
    const result = await authorizedAnalytics(request(), config, async url => {
      if (mode === 'network') throw new Error('secret failure detail');
      if (url.endsWith('/user')) return Response.json({ id: 'owner' });
      return mode === 'large' ? Response.json({ text: 'x'.repeat(270000) }) : Response.json({ schema_version: 2 });
    });
    assert.equal(result.response.status, 503); assert(!('metrics' in result));
    assert.equal(result.response.headers.get('vary'), 'Authorization');
  }
});
test('import freshness uses original source time, preserves capture time and rejects future dates', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const result = summarizeImport({ fetchedAt: '2026-10-16T11:00:00Z', questions: [{ created_at: '2026-09-12T12:00:00Z' }, { created_at: 'bad' }, { created_at: '2099-01-01' }], source: { name: 'Apify', duplicateItems: 2, emptyItems: 3 } }, now);
  assert.equal(result.stale, true); assert.equal(result.invalidDates, 2); assert.equal(result.duplicates, 2);
  assert.equal(result.newestPostAt, '2026-09-12T12:00:00.000Z'); assert.equal(result.capturedAt, '2026-10-16T11:00:00.000Z');
  assert.equal(result.posts, 3); assert.equal(result.newestPostAgeHours, 34 * 24);
  assert.equal(summarizeImport({}, now).stale, true);
  assert.equal(summarizeImport({ source: { name: 'Apify' }, questions: [{ created_at: '2026-10-16T11:00:00Z' }] }, now).stale, false);
});
test('synthetic archive fixture is never reported as live inventory', async () => {
  const fixture = JSON.parse(await readFile(new URL('../src/data/archive-fixture.json', import.meta.url), 'utf8'));
  const result = summarizeImport(fixture);
  assert.equal(result.available, false); assert.equal(result.posts, null); assert.equal(result.newestPostAt, null);
  assert.equal(result.capturedAt, null); assert.equal(result.duplicates, null); assert.match(result.mode, /fixture/);
});
test('dashboard client uses no service secret, trackers or fabricated demo metrics', async () => {
  const client = await readFile(new URL('../src/components/OwnerAnalyticsDashboard.tsx', import.meta.url), 'utf8');
  assert(!/service_role|SUPABASE_SERVICE|umami\.is\/script|posthog\.init/.test(client));
  assert(client.includes('controller.abort()')); assert(client.includes('setData(null)'));
  assert(client.includes('Sample activity is never presented as live data'));
  const route = await readFile(new URL('../src/app/api/admin/analytics/route.ts', import.meta.url), 'utf8');
  assert(route.indexOf("if ('response' in authorized)") < route.indexOf('summarizeImport(archive)'));
});

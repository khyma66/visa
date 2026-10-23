// One secret, one bounded Free-tier campaign. Each stage is single-use and cleaned.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TARGET } from './free-tier.mjs';
import { checkEvidence, UUID } from './multiuser-core.mjs';

const base = resolve('.local/multiuser');
const stages = [10, 50, 100];
const resume100 = process.argv.length === 3 && process.argv[2] === '--resume-100';
assert(process.argv.length === 2 || resume100, 'Only --resume-100 is supported');
const campaignId = randomUUID();
const reportPath = resolve(base, `campaign-${campaignId}.json`);
const report = { schemaVersion: 1, campaignId, target: TARGET, startedAt: new Date().toISOString(),
  browser: null, stages: [], resumed100: resume100, passed: false };
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const shellEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  VISAFLOW_MULTIUSER_PUBLIC_KEY: process.env.VISAFLOW_MULTIUSER_PUBLIC_KEY,
  VISAFLOW_MULTIUSER_ENCRYPTION_KEY: process.env.VISAFLOW_MULTIUSER_ENCRYPTION_KEY };
assert(/^sb_secret_[\w-]{20,}$/.test(process.env.VISAFLOW_MULTIUSER_ADMIN_KEY ?? ''), 'Dev secret required');
assert(/^sb_publishable_[\w-]{20,}$/.test(shellEnv.VISAFLOW_MULTIUSER_PUBLIC_KEY ?? ''), 'Dev publishable key required');
const adminKey = process.env.VISAFLOW_MULTIUSER_ADMIN_KEY;
delete process.env.VISAFLOW_MULTIUSER_ADMIN_KEY;

async function command(args, admin = false) {
  const child = spawn(process.execPath, ['tests/scale/multiuser.mjs', ...args], {
    cwd: process.cwd(), env: admin ? { ...shellEnv, VISAFLOW_MULTIUSER_ADMIN_KEY: adminKey } : shellEnv,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const done = new Promise((resolveStatus, reject) => {
    child.once('error', reject); child.once('close', resolveStatus);
  });
  let output = '';
  for await (const chunk of child.stdout) { output += chunk; assert(output.length < 128_000, 'Command output bound'); }
  const status = await done;
  process.stdout.write(output);
  return { status, output };
}
function runIdFrom(output) {
  const line = output.trim().split('\n').at(-1) ?? '';
  try { const id = JSON.parse(line).runId; return UUID.test(id) ? id : null; } catch { return null; }
}
async function evidence(count) {
  const provider = await fetch('https://status.supabase.com/api/v2/summary.json',
    { signal: AbortSignal.timeout(10000), redirect: 'error' }).then(r => {
    assert(r.ok, 'Supabase status unavailable'); return r.json();
  });
  assert.equal(provider.status?.indicator, 'none', 'Supabase reports service impact');
  assert(!(provider.incidents ?? []).some(i => ['investigating', 'identified'].includes(i.status)),
    'Supabase has an active incident');
  const e = await json(resolve(base, 'limits.json'));
  checkEvidence(e, count);
  return e;
}
async function stage(count, { browser = false } = {}) {
  await evidence(count);
  const provision = await command(['provision', String(count)], true);
  const runId = runIdFrom(provision.output);
  assert(runId, 'Provision did not create a manifest; no accounts can be owned by this campaign');
  const stageReport = { users: count, runId, provisioned: provision.status === 0,
    browser, passed: false, cleanupVerified: false };
  if (browser) report.browser = stageReport; else report.stages.push(stageReport);
  await save();
  let runStatus = 1;
  try {
    assert.equal(provision.status, 0, 'Provisioning failed');
    if (browser) {
      const prep = await new Promise((resolveStatus, reject) => {
        const child = spawn(process.execPath, ['tests/scale/browser-fixtures.mjs', runId],
          { env: shellEnv, stdio: 'inherit' });
        child.once('error', reject); child.once('close', resolveStatus);
      });
      assert.equal(prep, 0, 'Browser fixtures could not be prepared');
      console.log(JSON.stringify({ browserReady: true, runId, checkFile: resolve(base, runId, 'browser-check.json') }));
      const deadline = Date.now() + 30 * 60_000;
      while (Date.now() < deadline) {
        const check = await json(resolve(base, runId, 'browser-check.json')).catch(() => null);
        if (check) {
          assert.equal(check.runId, runId);
          assert.equal(check.origin, TARGET.origin);
          assert.equal(check.loginAndPolicy, true);
          assert.equal(check.postAndReply, true);
          assert.equal(check.inboxAndMessages, true);
          assert.equal(check.reloadPersistence, true);
          stageReport.passed = true; runStatus = 0; break;
        }
        await delay(1000);
      }
      assert.equal(runStatus, 0, 'Browser checks timed out or failed');
    } else {
      const run = await command(['run', runId]);
      runStatus = run.status;
      const result = await json(resolve(base, runId, 'result.json')).catch(() => null);
      stageReport.passed = run.status === 0 && result?.passed === true && result.authenticated === count && result.peakSubscribed === count;
      assert(stageReport.passed, 'Hosted stage failed');
    }
  } finally {
    const cleanup = await command(['cleanup', runId], true);
    const check = await json(resolve(base, runId, 'cleanup.json')).catch(() => null);
    stageReport.cleanupVerified = cleanup.status === 0 && check?.passed === true;
    await unlink(resolve(base, runId, 'browser-fixtures.json')).catch(() => {});
    await save();
  }
  assert(stageReport.passed && stageReport.cleanupVerified, 'Stage or cleanup failed');
  return runId;
}

try {
  const local = await json(resolve(base, 'local-protocol-100.json'));
  assert(local.passed === true && local.cleanupVerified === true && local.authenticated === 100 &&
    Date.now() - Date.parse(local.executedAt) < 86400000, 'Fresh passing local 100-user protocol report required');
  await evidence(resume100 ? 100 : 10);
  await save();
  if (!resume100) await stage(4, { browser: true });
  for (const count of resume100 ? [100] : stages) {
    const previous = report.stages.at(-1);
    if (previous) {
      const e = await json(resolve(base, 'limits.json'));
      e.previousRunId = previous.runId;
      e.previousStage = { users: previous.users, passed: previous.passed, cleanupVerified: previous.cleanupVerified };
      await writeFile(resolve(base, 'limits.json'), JSON.stringify(e, null, 2) + '\n', { mode: 0o600 });
    }
    await stage(count);
  }
  report.passed = true;
} catch (error) {
  report.failure = error?.message ?? 'Campaign failed';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ campaignId, passed: report.passed, browser: report.browser?.passed,
    stages: report.stages.map(s => ({ users: s.users, passed: s.passed, cleanupVerified: s.cleanupVerified })),
    failure: report.failure, reportPath }));
}

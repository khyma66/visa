import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const requiredReviews = [
  'database_access', 'exposed_credentials_rotated', 'email_signup_confirmation_recovery',
  'moderator_assigned', 'privacy_terms_and_support', 'backup_restore', 'pilot_load_and_cost',
  'bot_and_auth_abuse', 'privacy_requests_and_retention', 'public_takedown_intake',
  'age_and_us_legal_review', 'human_cross_account_tests', 'accessibility_review',
  'dependency_and_security_review', 'incident_response_and_alerts',
];

export function releaseProblems(env, review, config) {
  const problems = [];
  const origin = (value) => { try { const u = new URL(value); return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && !['localhost','127.0.0.1'].includes(u.hostname); } catch { return false; } };
  if (!origin(env.NEXT_PUBLIC_SUPABASE_URL) || env.NEXT_PUBLIC_SUPABASE_URL?.includes('your-project')) problems.push('A real HTTPS Supabase URL is required.');
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  let safeKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
  if (key.split('.').length === 3) {
    try { safeKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch { safeKey = false; }
  }
  if (!safeKey) problems.push('Only a publishable/anon key may be exposed to the browser.');
  if (env.NEXT_PUBLIC_APP_ENV !== 'production') problems.push('NEXT_PUBLIC_APP_ENV must be production.');
  if (!origin(env.NEXT_PUBLIC_SITE_URL)) problems.push('A real HTTPS public site origin is required.');
  const allowed = new Set(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_APP_ENV','NEXT_PUBLIC_SITE_URL']);
  if (Object.keys(env).some((key) => key.startsWith('NEXT_PUBLIC_') && !allowed.has(key))) problems.push('Review unexpected NEXT_PUBLIC variables before exposing them to the browser.');
  if (review.siteOrigin !== env.NEXT_PUBLIC_SITE_URL || review.databaseOrigin !== env.NEXT_PUBLIC_SUPABASE_URL) problems.push('Release evidence must match the selected site and database.');
  for (const name of requiredReviews) {
    const check = review.checks?.[name];
    if (check?.status !== 'verified' || !check.evidence?.trim() || !check.verifiedBy?.trim()) problems.push(`Unverified launch requirement: ${name}`);
  }
  const production = config.env?.production;
  if (production?.vars?.APP_ENV !== 'production' || production.vars.PUBLIC_LAUNCH_APPROVED !== 'true') problems.push('Production Worker must remain closed until PUBLIC_LAUNCH_APPROVED is deliberately enabled.');
  const imports = review.checks?.imported_content_rights;
  if (production?.vars?.IMPORTED_CONTENT_APPROVED === 'true' &&
    (imports?.status !== 'verified' || !imports.evidence?.trim() || !imports.verifiedBy?.trim())) problems.push('Imported content requires a distribution/privacy review with evidence and a reviewer.');
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const review = JSON.parse(readFileSync(new URL('../docs/release-review.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const problems = releaseProblems(process.env, review, config);
  if (problems.length) { console.error(`Public release blocked:\n${problems.map((p) => `- ${p}`).join('\n')}`); process.exitCode = 1; }
  else console.log('Release configuration and owner-recorded checks passed. Run tests, build, and hosted smoke checks before opening traffic.');
}

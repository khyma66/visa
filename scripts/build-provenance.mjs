import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function sourceProvenance(root = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const reviewedSource = entries.split('\0').filter((entry) => entry.slice(entry.indexOf('\t') + 1) !== 'docs/release-review.json').join('\0');
    return {
      gitSha: git('rev-parse', 'HEAD'),
      gitTree: git('rev-parse', 'HEAD^{tree}'),
      // Review evidence may be committed after inspecting the source without changing its fingerprint.
      sourceSha256: sha256(reviewedSource),
      dirty: git('status', '--porcelain=v1', '--untracked-files=normal').length > 0,
    };
  } catch {
    return { gitSha: null, gitTree: null, sourceSha256: null, dirty: true };
  }
}

function publicOrigin(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

export function buildProvenance(root = process.cwd(), env = process.env) {
  const appEnvironment = env.NEXT_PUBLIC_APP_ENV ?? env.CLOUDFLARE_ENV ?? 'development';
  const siteOrigin = publicOrigin(env.NEXT_PUBLIC_SITE_URL);
  // Only public build settings and the checked-in Worker config participate. Never serialize secrets.
  const publicConfig = {
    appEnvironment,
    siteOrigin,
    backendOrigin: publicOrigin(env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKeyDigest: sha256(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''),
    workerEnvironment: env.CLOUDFLARE_ENV ?? null,
    workerConfigDigest: sha256(readFileSync(resolve(root, 'wrangler.jsonc'))),
  };
  return {
    schemaVersion: 1,
    ...sourceProvenance(root),
    appEnvironment,
    siteOrigin,
    configSha256: sha256(JSON.stringify(publicConfig)),
  };
}

export function buildProvenanceSource(root = process.cwd(), env = process.env) {
  const filename = resolve(root, '.cache/visaflow/build-provenance.json');
  mkdirSync(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(buildProvenance(root, env), null, 2)}\n`);
  renameSync(temporary, filename);
  return filename;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(sourceProvenance(), null, 2));
}

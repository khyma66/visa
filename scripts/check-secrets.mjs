import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Report only source locations and credential types, never matching values.
export function scanContent(content, filename) {
  const findings = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const kinds = new Set();
    for (const match of line.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{10,}/g)) {
      try {
        const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (payload.role === 'service_role' || payload.role === 'authenticated') {
          kinds.add('privileged-or-user-jwt');
        }
      } catch { /* A malformed token is not evidence of a privileged JWT. */ }
    }
    if (/(?:sb_secret_[A-Za-z0-9_-]{12,}|(?:sk_live_|sk_test_|gsk_|apify_api_|ghp_)[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/.test(line)) {
      kinds.add('provider-secret');
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) {
      kinds.add('private-key');
    }
    const assignment = line.match(/\b[A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|ACCESS_KEY)(?:_ID)?\s*[:=]\s*["'`]?([A-Za-z0-9/+_.=-]{20,})/i);
    if (assignment) {
      const value = assignment[1];
      const reference = /^(?:process\.|import\.meta\.|settings\.|os\.|(?:self\.)?env\.)/.test(value);
      const placeholder = /^(?:your[-_]|replace[-_]|example[-_]|placeholder|test[-_]|x{8,})/i.test(value);
      if (!reference && !placeholder) kinds.add('literal-secret-assignment');
    }
    for (const type of kinds) findings.push({ file: filename, line: index + 1, type });
  }
  return findings;
}

export function scanRepository(cwd = process.cwd()) {
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
  const findings = [];
  for (const filename of new Set(names.split('\0').filter(Boolean))) {
    const path = resolve(cwd, filename);
    let bytes;
    try {
      if (!lstatSync(path).isFile()) continue;
      bytes = readFileSync(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue; // Tracked file deleted in the working tree.
      throw error;
    }
    if (bytes.includes(0)) continue;
    findings.push(...scanContent(bytes.toString('utf8'), filename));
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const findings = scanRepository();
    for (const finding of findings) console.error(JSON.stringify(finding));
    if (findings.length) {
      console.error(`Secret check failed: ${findings.length} credential finding(s). Values were not printed.`);
      process.exitCode = 1;
    } else {
      console.log('Secret check passed for tracked and non-ignored source files. Git history was not scanned.');
    }
  } catch {
    console.error('Secret check could not inspect the repository. No file contents were printed.');
    process.exitCode = 1;
  }
}

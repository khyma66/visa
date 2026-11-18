import { pathToFileURL } from 'node:url';

const reviewed = {
  id: 1247710,
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  severity: 'high',
  vulnerable_versions: '<=4.0.7',
};

// npm audit identifies our private forks by their own names. Check the original
// upstream package separately so new high/critical advisories still fail closed.
export function checkUpstreamAdvisories(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid advisory response');
  if (Object.keys(data).some(key => key !== 'picomatch')) throw new Error('Unexpected upstream advisory response');
  if (data.picomatch === undefined) return;
  if (!Array.isArray(data.picomatch)) throw new Error('Invalid picomatch advisory list');
  for (const item of data.picomatch) {
    if (!item || typeof item !== 'object' || typeof item.severity !== 'string' || typeof item.url !== 'string') throw new Error('Invalid picomatch advisory');
    if (item.id === reviewed.id || item.url === reviewed.url) {
      if (Object.entries(reviewed).some(([key, value]) => item[key] !== value)) throw new Error('The reviewed picomatch advisory changed; review the fork again');
      continue;
    }
    if (['high', 'critical'].includes(item.severity.toLowerCase())) throw new Error(`Unreviewed picomatch advisory: ${item.url}`);
  }
}

async function main() {
  const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ picomatch: ['2.3.2', '4.0.7'] }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Upstream advisory check failed: HTTP ${response.status}`);
  checkUpstreamAdvisories(await response.json());
  console.log('PASS: no unreviewed high-severity picomatch advisories');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

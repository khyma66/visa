import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Production must never bundle the development scrape, even when import
// distribution is separately approved. Production data needs a reviewed import.
export function archiveSource(root, env = process.env) {
  const local = resolve(root, 'src/data/api-archive.json');
  return env.CLOUDFLARE_ENV !== 'production' && env.NEXT_PUBLIC_APP_ENV !== 'production' &&
    !env.CI && existsSync(local) ? local : resolve(root, 'src/data/archive-fixture.json');
}

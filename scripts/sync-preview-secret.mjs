// Explicitly scopes the existing ingestion credential to the development Worker.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
const token = parseEnv(readFileSync(new URL('../.dev.vars',import.meta.url),'utf8')).APIFY_TOKEN;
if (!token || token.includes('replace_')) throw new Error('A configured APIFY_TOKEN is required in ignored .dev.vars.');
const child = spawn('node_modules/.bin/wrangler',['secret','put','APIFY_TOKEN','--env','development'],{stdio:['pipe','inherit','inherit']});
child.stdin.end(token);
child.on('error',() => { console.error('Could not start the secret uploader.'); process.exitCode=1; });
child.on('exit',(code) => { process.exitCode=code ?? 1; });

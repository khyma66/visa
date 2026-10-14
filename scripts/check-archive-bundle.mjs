import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { archiveSource } from './archive-source.mjs';

const root = process.cwd();
const selected = archiveSource(root);
const expected = JSON.parse(await readFile(selected, 'utf8'));
const directory = resolve(root, 'dist/server');
const chunks = [];
for (const file of await readdir(directory, { recursive: true })) {
  if (file.endsWith('.js')) chunks.push(await readFile(resolve(directory, file), 'utf8'));
}
const bundled = chunks.join('\n');
for (const question of expected.questions) assert(bundled.includes(question.id), 'The selected archive is missing from the server build.');
if (selected.endsWith('archive-fixture.json')) {
  let privateArchive;
  try { privateArchive = JSON.parse(await readFile(resolve(root, 'src/data/api-archive.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const question of privateArchive?.questions ?? []) assert(!bundled.includes(question.id), 'A private development post was bundled into CI/production.');
}
console.log(`PASS archive bundle: ${expected.questions.length} ${selected.endsWith('archive-fixture.json') ? 'synthetic fixture' : 'private development'} posts; no post text logged.`);

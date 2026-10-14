import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Release-only integration check. The archive remains ignored and is never
// substituted with a fixture when it is missing. No source content is logged.
const archiveFile = new URL('../src/data/api-archive.json', import.meta.url);
const selectionSource = await readFile(new URL('../src/lib/post-presentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(selectionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { selectedExperiences, usVisaPost } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

export async function checkPrivateExperiences(file = archiveFile) {
  let archive;
  try { archive = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Required private experience archive is missing. Provision the reviewed src/data/api-archive.json in the protected release workspace; it must remain untracked.');
    throw new Error('Required private experience archive could not be read as valid JSON.');
  }
  assert(Array.isArray(archive?.questions), 'Private experience archive must contain a questions array.');
  const before = JSON.stringify(archive.questions);
  const selected = selectedExperiences(archive.questions);
  assert.equal(selected.length, 4, 'Private archive must contain all four reviewed, visible U.S. experience posts.');
  assert.equal(new Set(selected.map(post => post.id)).size, 4, 'Reviewed experience posts must be unique.');
  assert.equal(JSON.stringify(archive.questions), before, 'Experience selection must not mutate the archive.');
  for (const post of selected) {
    const original = archive.questions.find(question => question.id === post.id);
    assert(original && usVisaPost(post), 'Reviewed experience must retain an available U.S. source post.');
    for (const field of ['body', 'created_at', 'updated_at', 'answer_count', 'author_id', 'author_username', 'source', 'source_url'])
      assert.equal(post[field], original[field], `Experience selection must preserve ${field}.`);
    assert.deepEqual(post.tags, original.tags, 'Experience selection must preserve original tags.');
    assert.equal(post.post_kind, 'experience', 'Reviewed post must appear as an experience.');
    assert(post.experience_category, 'Reviewed experience must have a category.');
  }
  assert.equal(selectedExperiences(selected.map(post => ({ ...post, status: 'archived' }))).length, 0, 'Removed experiences must not be selected.');
  assert.equal(selectedExperiences([{ ...selected[0], id: 'apify-unreviewed', body: 'Synthetic unreviewed experience question.' }]).length, 0, 'Unreviewed posts must not be selected.');
  return selected.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const count = await checkPrivateExperiences();
    console.log(`PASS private experience archive: ${count} reviewed posts; original content, dates and ownership retained. No post content logged.`);
  } catch (error) {
    // Avoid assertion diffs or JSON parse excerpts exposing private post text.
    console.error(`Private experience release check failed: ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  }
}

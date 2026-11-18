import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Load the real presentation helpers (pure TypeScript, no framework imports used here).
const source = await readFile(new URL('../src/lib/post-presentation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { importedTitle, cleanImportedText, usVisaPost } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('an imported post that opens with its own heading line uses it as the title', () => {
  assert.equal(importedTitle('1. Does my status automatically change now?', 'F-1 to H-1 COS timeline and queries help\nHi everyone,\n\nMy employer filed', 'apify-1'), 'F-1 to H-1 COS timeline and queries help');
  assert.equal(importedTitle('Would you give notice?', '## H1b transfer advice! Help!\n\nI got an offer', 'apify-2'), 'H1b transfer advice! Help!');
  assert.equal(importedTitle('Question', '[H1B transfer while on COS pending]\n\nDetails', 'apify-3'), 'H1B transfer while on COS pending');
});

test('greetings, sentences and running paragraphs are not mistaken for headings', () => {
  assert.equal(importedTitle('Is there a way to expedite?', 'ADMIN PLEASE APPROVE. NEED URGENT ADVICE.\n\nI applied', 'apify-4'), 'Is there a way to expedite?');
  assert.equal(importedTitle('what should i do now any thoughts?', 'I filed stem opt its got approved but my card was lost\nI contacted usps', 'apify-5'), 'what should i do now any thoughts?');
  assert.equal(importedTitle('Do I need to reactivate SEVIS?', 'Hi everyone, I am wondering\n\nDetails', 'apify-6'), 'Do I need to reactivate SEVIS?');
});

test('cut-off titles end at a complete sentence without splitting abbreviations', () => {
  assert.equal(importedTitle('I have my F-1 visa interview coming up soon at the **U.S. Consulate in Kolkata. **I wanted', '**Hi everyone! 👋**\n\nI have', 'apify-7'),
    'I have my F-1 visa interview coming up soon at the U.S. Consulate in Kolkata.');
});

test('reviewed Telegram titles are kept, and handles and hashtags are not shown', () => {
  assert.equal(importedTitle('F-1 Refusal for SUNY Buffalo', 'Long first line that could look like a heading\n\nmore', 'apify-telegram-F1-1'), 'F-1 Refusal for SUNY Buffalo');
  assert.equal(cleanImportedText('Hi @InfinityAP999 Consulate: #Mumbai #Spring2027, mail a@b.com **bold**'), 'Hi a member Consulate: Mumbai Spring2027, mail a@b.com bold');
});

test('display scope cleans imported posts only and leaves member posts untouched', () => {
  const imported = usVisaPost({ id: 'apify-9', source: 'apify', destination_country: 'United States', visa_type: 'H-1B', title: '**Bold** title here', body: 'Ask @someone_here' });
  assert.equal(imported.title, 'Bold title here');
  assert.equal(imported.body, 'Ask a member');
  const member = { id: 'uuid-1', destination_country: 'United States', visa_type: 'H-1B', title: '**kept** as typed', body: 'Ask @friend' };
  assert.equal(usVisaPost(member), member);
});

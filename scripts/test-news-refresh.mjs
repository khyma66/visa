import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { refreshNews } from './refresh-news.mjs';
import { refreshImmigrationHeadlines } from './refresh-immigration-headlines.mjs';
const now = Date.parse('2026-10-29T12:00:00Z');
const row = { title: 'H-1B Visa Update', document_number: '2026-20000', html_url: 'https://www.federalregister.gov/documents/2026/10/28/2026-20000/visa-update', publication_date: '2026-10-28', type: 'Notice', agencies: [{name:'State Department',slug:'state-department'}], abstract: 'Public agency abstract describing the visa notice.' };
test('scheduled collection merges and deduplicates topics, retaining source abstracts and original dates', async () => {
  const queries = [];
  const feed = await refreshNews(undefined, async url => { queries.push(url.searchParams.get('conditions[term]')); return Response.json({results: [row]}); }, () => now);
  assert.deepEqual(queries, ['visa', 'immigration']); assert.equal(feed.articles.length, 1);
  assert.equal(feed.articles[0].summary, row.abstract); assert.equal(feed.articles[0].publishedOn, row.publication_date);
});
test('complete upstream failure rejects without mutating the previous edition', async () => {
  const previous = {sentinel: 'unchanged'};
  await assert.rejects(refreshNews(previous, async () => { throw Error('offline'); }, () => now), /existing edition preserved/);
  assert.deepEqual(previous, {sentinel: 'unchanged'});
});
test('empty feeds never erase a previously saved edition', async () => {
  await assert.rejects(refreshNews(undefined, async () => Response.json({results: []}), () => now), /existing edition preserved/);
});
test('one failed topic retains previous articles alongside newly collected articles', async () => {
  const previous = await refreshNews(undefined, async () => Response.json({results:[row]}), () => now);
  const nextRow = {...row,document_number:'2026-20001',html_url:row.html_url.replace('2026-20000','2026-20001')};
  const next = await refreshNews(previous, async url => {
    if(url.searchParams.get('conditions[term]')==='visa') throw Error('offline');
    return Response.json({results:[nextRow]});
  }, () => now + 1000);
  assert.equal(next.articles.length, 2); assert.equal(previous.articles.length, 1);
});
test('scheduled news checks daily, can be run manually, and keeps the previous edition as the next commit parent', async () => {
  const workflow = await readFile(new URL('../.github/workflows/news-refresh.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '23 13 \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /git fetch origin refs\/heads\/news-data:refs\/remotes\/origin\/news-data/);
  assert.match(workflow, /git commit-tree "\$tree" -p "\$parent"/);
  assert.match(workflow, /git push origin "\$commit:refs\/heads\/news-data"/);
  assert.match(workflow, /refresh-immigration-headlines\.mjs/);
  assert.match(workflow, /immigration-headlines\.json/);
});
test('publisher edition accepts attributed U.S. visa headlines but rejects unrelated and unsafe links', async () => {
  const rows = [
    {title:'U.S. H-1B visa rule update',url:'https://example.com/immigration/h1b',domain:'example.com',seendate:'20261029110000'},
    {title:'Visa stock rises on card payments',url:'https://example.com/finance',domain:'example.com',seendate:'20261029100000'},
    {title:'USCIS green card update',url:'http://127.0.0.1/private',domain:'unsafe',seendate:'20261029090000'},
  ];
  const edition = await refreshImmigrationHeadlines(undefined, async () => Response.json({articles:rows}), () => now);
  assert.equal(edition.source,'GDELT Project');
  assert.equal(edition.articles.length,1);
  assert.equal(edition.articles[0].publisher,'example.com');
  assert.equal(edition.articles[0].url,'https://example.com/immigration/h1b');
});
test('headline source failure preserves the previous edition', async () => {
  const previous = {sentinel:'unchanged'};
  await assert.rejects(refreshImmigrationHeadlines(previous, async () => new Response('',{status:429}), () => now), /existing edition preserved/);
  assert.deepEqual(previous,{sentinel:'unchanged'});
});

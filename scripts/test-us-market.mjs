import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await read(name), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);
const {usVisaPost,topicLabel} = await load('src/lib/post-presentation.ts');
const {VISA_TYPES} = await load('src/lib/post-categories.ts');

test('U.S. forms omit unrelated visa categories and retain current U.S. types', () => {
  assert(!VISA_TYPES.some(type => /schengen|canada|study permit|work permit/i.test(type)));
  for(const type of ['H-1B','H-4','H-4 / EAD','B1/B2','F-1 / OPT','Other']) assert(VISA_TYPES.includes(type));
});
test('unrelated visas are hidden without deleting or rewriting the input', () => {
  for(const visa_type of ['Schengen','Study permit','Canada work permit','Canada visa']) {
    const post={destination_country:'Canada',visa_type,title:'Applying from the USA',body:'My Canadian visa appointment'};
    const before=JSON.stringify(post);assert.equal(usVisaPost(post),null);assert.equal(JSON.stringify(post),before);
  }
});
test('U.S. re-entry and H-1B stamping stay visible even when Canada is mentioned', () => {
  for(const text of ['Renew I-94 through Canada','Reset I 94 at a border','I94 after travel','H1-B visa stamping in Mexico']) {
    const post={destination_country:'Canada',visa_type:'Canada visa',title:text};
    const scoped=usVisaPost(post);assert.equal(scoped.destination_country,'United States');assert(!scoped.visa_type.includes('Canada'));assert.equal(post.destination_country,'Canada');
  }
});
test('topic labels retain visa acronym capitalization and do not change tag identifiers', () => {
  for(const [input,expected] of [['h1b','H-1B'],['h4','H-4'],['uscis','USCIS'],['ead','EAD'],['premium-processing','Premium Processing'],['visa-question','Visa Question']]) assert.equal(topicLabel(input),expected);
});
test('feed options are populated from posts, not an unrelated static catalog', async () => {
  const source=await read('src/components/CommunityHome.tsx');
  assert(source.includes('new Set(questions.map('));assert(source.includes('VISA_TYPES.includes(type)'));
  assert(!source.includes('[...VISA_TYPES,'));
});
test('country controls are fixed to U.S. and community searches are scoped', async () => {
  for(const file of ['AskQuestionForm','CreateCommunity','ExploreCommunities']) {
    const source=await read(`src/components/${file}.tsx`);
    assert(source.includes("const country = 'United States'"));assert(!source.includes('setCountry('));
    assert(!source.includes('Canada study permits'));assert(!source.includes('Country or Worldwide'));
  }
});
test('brand accents meet normal-text contrast against white', () => {
  const luminance=hex=>{const rgb=hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const color of ['c2410c','1d4ed8','9a3412']) assert(1.05/(luminance(color)+.05)>=4.5);
});

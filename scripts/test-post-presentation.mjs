import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';

// Render the actual TSX components. Only framework navigation, session state and
// network dependencies are substituted; presentation and policy helpers are real.
const require = createRequire(import.meta.url);
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const fileModule = (name) => pathToFileURL(require.resolve(name)).href;
const jsx = fileModule('react/jsx-runtime');
const link = moduleUrl(`import {jsx} from ${JSON.stringify(jsx)}; export default function Link(props) { return jsx('a',{...props}); }`);
const auth = moduleUrl(`let user=null; export function setUser(value){user=value;} export function useAuth(){return {user,demoMode:false};}`);
const icons = moduleUrl(`import {jsx} from ${JSON.stringify(jsx)}; function Icon({size,...props}){return jsx('svg',props);} export {Icon as ArrowDown,Icon as ArrowUp,Icon as Check,Icon as CheckCircle2,Icon as ExternalLink,Icon as Eye,Icon as GitFork,Icon as MessageCircle,Icon as Share2,Icon as ThumbsUp};`);
const dependencies = {
  'react/jsx-runtime': jsx,
  react: fileModule('react'),
  'next/link': link,
  'next/navigation': moduleUrl(`export function useParams(){return {id:'fixture-question'};}`),
  'lucide-react': icons,
  'date-fns': moduleUrl(`export function formatDistanceToNow(){return '2 days ago';}`),
  '@/lib/community': moduleUrl(`const unused=()=>{throw new Error('Unexpected network call during render');}; export {unused as acceptAnswer,unused as createAnswer,unused as getQuestion,unused as listAnswers,unused as voteAnswer,unused as voteQuestion};`),
  '@/lib/realtime': moduleUrl(`export function subscribeLive(){throw new Error('Unexpected subscription during render');}`),
  './Avatar': moduleUrl(`export function Avatar(){return null;}`),
  './RelatedQuestions': moduleUrl(`export function RelatedQuestions(){return null;}`),
  './AuthProvider': auth,
  './ReportButton': moduleUrl(`export function ReportButton(){return null;}`),
};
async function compile(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (match, prefix, _quote, name) => {
    assert(dependencies[name], `Unmocked dependency ${name} in ${relativePath}`);
    return prefix + JSON.stringify(dependencies[name]);
  });
  return moduleUrl(code);
}
dependencies['@/lib/post-presentation'] = await compile('../src/lib/post-presentation.ts');
dependencies['./SafetyNotice'] = await compile('../src/components/SafetyNotice.tsx');
const { QuestionCard } = await import(await compile('../src/components/QuestionCard.tsx'));
const { QuestionDetail } = await import(await compile('../src/components/QuestionDetail.tsx'));
const { setUser } = await import(auth);

const question = {
  id: 'fixture-question', author_id: 'real-author', author_username: 'visa_tester',
  author_avatar_seed: 'fixture-avatar', title: 'Documents for a visa interview',
  body: 'Which documents should I prepare for my upcoming visa interview?',
  destination_country: 'US', visa_type: 'F1', tags: ['interview', 'documents'],
  status: 'open', vote_score: 12, answer_count: 2, view_count: 3,
  accepted_answer_id: null, created_at: '2026-10-03T12:00:00Z', updated_at: '2026-10-03T12:00:00Z',
  source: 'visaflow',
};
const answer = {
  id: 'fixture-answer', question_id: question.id, author_id: 'answer-author',
  author_username: 'reply_tester', author_avatar_seed: 'reply-avatar',
  body: 'Check the official appointment instructions for your consulate.',
  vote_score: 3, is_accepted: false, status: 'active',
  created_at: question.created_at, updated_at: question.updated_at, source: 'visaflow',
};
const imported = {
  ...question, source: 'apify', author_id: '', source_group: 'External group sentinel',
  source_label: 'Archive source sentinel', source_url: 'https://example.org/archive-sentinel',
};
const renderDetail = (post, replies = [], viewerId = 'viewer') => {
  setUser(viewerId === null ? null : { id: viewerId });
  return renderToStaticMarkup(createElement(QuestionDetail, { initialQuestion: post, initialAnswers: replies }));
};
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const accessibleLabels = (html) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]).join(' ');
function assertNoImportPresentation(html) {
  const surface = `${visibleText(html)} ${accessibleLabels(html)}`;
  assert.doesNotMatch(surface, /imported|apify|source reactions|source comments|view source|open group post|group comment|group question|group discussion|source of record|collected snapshot|VisaFlow replies|VisaFlow answer|VisaFlow only|external group sentinel|archive source sentinel/i);
  assert.doesNotMatch(html, /href="https:\/\/example\.org\/archive-sentinel/);
}
function assertQuestionMessage(html, expected) {
  assert.equal(visibleText(html).includes('Message author'), expected);
  assert.equal(/href="\/messages\?to=visa_tester"/.test(html), expected);
}
function assertReplyMessage(html, expected) {
  assert.equal(accessibleLabels(html).includes('Message reply_tester'), expected);
  assert.equal(/href="\/messages\?to=reply_tester"/.test(html), expected);
}

for (const sourceUrl of [imported.source_url, null, undefined]) {
  test(`imported question with source URL ${String(sourceUrl)} has no provenance UI or message action`, () => {
    const post = { ...imported, source_url: sourceUrl };
    for (const viewer of ['viewer', null]) {
      const html = renderDetail(post, [], viewer);
      assertNoImportPresentation(html);
      assertQuestionMessage(html, false);
      assert(visibleText(html).includes(post.title));
      assert(visibleText(html).includes(post.body));
    }
    assertNoImportPresentation(renderToStaticMarkup(createElement(QuestionCard, { question: post })));
  });
}
test('imported author ID cannot enable messaging, even when it looks like a real user', () => {
  assertQuestionMessage(renderDetail({ ...imported, author_id: 'real-author' }), false);
});
for (const source of ['visaflow', undefined]) {
  test(`real user question (${String(source)}) offers messaging to another viewer and guests`, () => {
    for (const viewer of ['viewer', null]) {
      assertQuestionMessage(renderDetail({ ...question, source }, [], viewer), true);
    }
  });
}
test('own question and question without an account have no messaging action', () => {
  assertQuestionMessage(renderDetail(question, [], question.author_id), false);
  for (const author_id of ['', ' ', null, undefined]) {
    assertQuestionMessage(renderDetail({ ...question, author_id }), false);
  }
});
test('source URL alone is never used as a proxy for message eligibility', () => {
  assertQuestionMessage(renderDetail({ ...question, source_url: imported.source_url }), true);
});
test('imported answers hide provenance and messaging even if an author ID is present', () => {
  for (const source_url of [imported.source_url, undefined]) {
    const html = renderDetail(imported, [{ ...answer, source: 'apify', source_url }]);
    assertNoImportPresentation(html);
    assertReplyMessage(html, false);
    assert(visibleText(html).includes(answer.body));
  }
});
test('real replies to imported questions retain messaging for other users and guests', () => {
  for (const viewer of ['viewer', null]) {
    const html = renderDetail(imported, [answer], viewer);
    assertNoImportPresentation(html);
    assertQuestionMessage(html, false);
    assertReplyMessage(html, true);
  }
});
test('own replies and replies without accounts never expose messaging', () => {
  assertReplyMessage(renderDetail(question, [answer], answer.author_id), false);
  for (const author_id of ['', ' ', null, undefined]) {
    assertReplyMessage(renderDetail(question, [{ ...answer, author_id }]), false);
  }
});
test('mixed discussion exposes messaging only for eligible native authors', () => {
  const replies = [
    { ...answer, id: 'imported', source: 'apify', author_username: 'archive_tester' },
    answer,
    { ...answer, id: 'orphan', author_id: '', author_username: 'orphan_tester' },
    { ...answer, id: 'own', author_id: 'viewer', author_username: 'self_tester' },
  ];
  const html = renderDetail(imported, replies);
  assertNoImportPresentation(html);
  const messageLabels = [...html.matchAll(/aria-label="Message ([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(messageLabels, ['reply_tester']);
});

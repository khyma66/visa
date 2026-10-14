import assert from 'node:assert/strict';
import ts from 'typescript';

const unsupported = Symbol('not-static-json');
function literal(node, values, depth = 0) {
  if (!node || depth > 30) return unsupported;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(node)) return values.get(node.text) ?? unsupported;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node)) {
    const rows = node.elements.map(child => literal(child, values, depth + 1));
    return rows.includes(unsupported) ? unsupported : rows;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return unsupported;
      const name = property.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return unsupported;
      const value = literal(ts.isShorthandPropertyAssignment(property) ? name : property.initializer, values, depth + 1);
      if (value === unsupported || Object.hasOwn(result, name.text)) return unsupported;
      result[name.text] = value;
    }
    return result;
  }
  // No code execution, function calls, template substitutions or evaluation.
  return unsupported;
}

export function archiveFromWorkerModule(source) {
  if (!source.includes('answersByQuestionId')) return null;
  const file = ts.createSourceFile('downloaded-worker.js', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'Worker module could not be parsed safely.');
  const values = new Map(); const archives = [];
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const value = literal(declaration.initializer, values);
      if (value === unsupported) continue;
      values.set(declaration.name.text, value);
      if (Array.isArray(value?.questions) && value?.answersByQuestionId && value?.source) archives.push(value);
    }
  }
  assert(archives.length <= 1, 'Ambiguous archive module; manual review required.');
  return archives[0] ?? null;
}

export async function recoverWorkerArchive(response) {
  assert(response.ok, `Worker download failed (${response.status}).`);
  const contentType = response.headers.get('content-type') ?? '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) { const row = await reader.read(); if (row.done) break; size += row.value.byteLength; assert(size < 40 * 1024 * 1024, 'Worker download exceeds limit.'); chunks.push(row.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  const modules = [];
  if (/multipart\/form-data/i.test(contentType)) {
    const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    for (const [name, value] of form) if (/\.m?js$/.test(name) && typeof value !== 'string') modules.push(await value.text());
  } else modules.push(body.toString('utf8'));
  const candidates = modules.map(archiveFromWorkerModule).filter(Boolean);
  assert.equal(candidates.length, 1, 'Expected exactly one literal archive in the current Worker.');
  return candidates[0];
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Idempotent current feed projection. It never changes body, author or dates. */
export function publishedArchive(archive) {
  const copy = structuredClone(archive);
  for (const question of copy.questions) {
    if (question.source !== 'apify' && !question.id.startsWith('apify-')) continue;
    const replies = [...new Map((copy.answersByQuestionId[question.id] ?? []).map(row => [row.id, row])).values()].filter(row => row.status === 'active' && row.question_id === question.id);
    copy.answersByQuestionId[question.id] = replies;
    question.source_comment_count ??= question.answer_count;
    question.answer_count = replies.length;
  }
  return copy;
}

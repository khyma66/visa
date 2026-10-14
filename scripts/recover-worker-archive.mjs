import assert from 'node:assert/strict';
import ts from 'typescript';

const unsupported = Symbol('not-static-json');
function literal(node, values, depth = 0, unsupportedKinds = {}) {
  if (!node || depth > 30) return unsupported;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(node)) return values.get(node.text) ?? unsupported;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  // Vite minifies JSON booleans to !0 / !1. Interpret just these literal forms;
  // arbitrary operators or expressions in a downloaded Worker are never run.
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isNumericLiteral(node.operand) && ['0', '1'].includes(node.operand.text)) return node.operand.text === '0';
  if (ts.isArrayLiteralExpression(node)) {
    const rows = node.elements.map(child => literal(child, values, depth + 1, unsupportedKinds));
    return rows.includes(unsupported) ? unsupported : rows;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return unsupported;
      const name = property.name;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return unsupported;
      const value = literal(ts.isShorthandPropertyAssignment(property) ? name : property.initializer, values, depth + 1, unsupportedKinds);
      if (value === unsupported || Object.hasOwn(result, name.text)) return unsupported;
      result[name.text] = value;
    }
    return result;
  }
  // No code execution, function calls, template substitutions or evaluation.
  const kind = ts.SyntaxKind[node.kind];
  unsupportedKinds[kind] = (unsupportedKinds[kind] ?? 0) + 1;
  return unsupported;
}

export function archiveFromWorkerModule(source, diagnostics) {
  if (!source.includes('answersByQuestionId')) return null;
  const file = ts.createSourceFile('downloaded-worker.js', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'Worker module could not be parsed safely.');
  const values = new Map(); const archives = [];
  const shapes = {}; const unsupportedKinds = {};
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const shape = ts.SyntaxKind[declaration.initializer?.kind] ?? 'none';
      shapes[shape] = (shapes[shape] ?? 0) + 1;
      const value = literal(declaration.initializer, values, 0, unsupportedKinds);
      if (value === unsupported) continue;
      values.set(declaration.name.text, value);
      if (Array.isArray(value?.questions) && value?.answersByQuestionId && value?.source) archives.push(value);
    }
  }
  if (diagnostics) Object.assign(diagnostics, { topLevelDeclarations: Object.values(shapes).reduce((a, b) => a + b, 0), initializerShapes: shapes, unsupportedSyntaxKinds: unsupportedKinds, literalArchives: archives.length });
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
  const modules = []; const parts = [];
  if (/multipart\/form-data/i.test(contentType)) {
    const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    for (const [name, value] of form) {
      const filename = typeof value === 'string' ? name : value.name;
      const type = typeof value === 'string' ? 'string' : value.type;
      const size = typeof value === 'string' ? Buffer.byteLength(value) : value.size;
      parts.push({ field: name, filename, type, bytes: size });
      if (/\.(?:m?js|json)$/.test(name) || /\.(?:m?js|json)$/.test(filename) || /javascript/.test(type)) modules.push({ name: filename || name, source: typeof value === 'string' ? value : await value.text() });
    }
  } else modules.push({ name: 'single-body', source: body.toString('utf8') });
  const moduleInfo = []; const candidates = [];
  for (const { name, source } of modules) {
    const info = { name, bytes: Buffer.byteLength(source), archiveMarkers: source.split('answersByQuestionId').length - 1 };
    moduleInfo.push(info);
    if (!info.archiveMarkers) continue;
    let candidate;
    if (/\.json$/.test(name) || /^[\s\r\n]*\{/.test(source)) {
      try { const value = JSON.parse(source); if (Array.isArray(value?.questions) && value?.answersByQuestionId && value?.source) candidate = value; }
      catch { /* A script beginning with a block is not treated as JSON. */ }
    }
    candidate ??= archiveFromWorkerModule(source, info);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length !== 1) console.log(JSON.stringify({ operation: 'archive-recovery-metadata', contentType, bytes: size, parts, modules: moduleInfo, candidates: candidates.length }));
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

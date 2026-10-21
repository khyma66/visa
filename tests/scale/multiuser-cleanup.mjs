import assert from 'node:assert/strict';
import { checkManifest, checkOwned, MARKER } from './multiuser-core.mjs';
const ok = result => { if (result.error) throw new Error('Cleanup operation failed'); return result.data; };

// Run only after the actor process exits, under the shared exclusive lock.
// Never trusts a text marker alone: Auth admin metadata, UUID and email must match.
export async function cleanup(admin, manifest) {
  checkManifest(manifest, { expired: true });
  const result = { schemaVersion: 1, runId: manifest.runId, passed: false, deletedUsers: 0, absentUsers: 0, checkedAt: new Date().toISOString() };
  try {
    const ids = manifest.users.map(u => u.id), set = new Set(ids), present = [];
    for (const fixture of manifest.users) {
      const found = await admin.auth.admin.getUserById(fixture.id);
      if (found.error?.code === 'user_not_found' && found.error?.status === 404) { result.absentUsers++; continue; }
      const user = ok(found).user; checkOwned(user, fixture, manifest.runId); present.push(fixture.id);
    }
    const rows = async (table, column, values) => {
      if (!values.length) return [];
      const data = ok(await admin.from(table).select('*').in(column, values).limit(1001));
      assert(data.length <= 1000, 'Unexpected fixture volume; manual inspection required'); return data;
    };
    // Validate the entire connected data set before the first destructive operation.
    const questions = await rows('questions', 'author_id', ids);
    const answers = await rows('answers', 'author_id', ids);
    const questionIds = questions.map(q => q.id);
    const attachedAnswers = await rows('answers', 'question_id', questionIds);
    const text = `${MARKER} ${manifest.runId}`;
    assert(questions.every(q => q.title.startsWith(text) && q.body.startsWith(text)));
    assert(answers.every(a => questionIds.includes(a.question_id) && a.body.startsWith(text)));
    assert(attachedAnswers.every(a => set.has(a.author_id) && a.body.startsWith(text)), 'Foreign replies prohibit cascading cleanup');
    const answerIds = answers.map(a => a.id);
    for (const [table, column, values] of [['question_votes', 'question_id', questionIds], ['answer_votes', 'answer_id', answerIds]])
      assert((await rows(table, column, values)).every(v => set.has(v.user_id)), 'Foreign votes prohibit cascading cleanup');
    const conversations = [...new Map([
      ...await rows('direct_conversations', 'user_one_id', ids), ...await rows('direct_conversations', 'user_two_id', ids),
    ].map(c => [c.id, c])).values()];
    assert(conversations.every(c => set.has(c.user_one_id) && set.has(c.user_two_id)), 'Foreign participant prohibits cleanup');
    const conversationIds = conversations.map(c => c.id);
    const messages = await rows('direct_messages', 'conversation_id', conversationIds);
    assert(messages.every(m => set.has(m.sender_id) && m.body.startsWith(text)));
    // Ban fixture accounts before data deletion; do not re-enable them on failure.
    for (const id of present) ok(await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' }));
    const remove = async (table, column, values) => { if (values.length) ok(await admin.from(table).delete().in(column, values)); };
    if (questionIds.length) ok(await admin.from('questions').update({ accepted_answer_id: null }).in('id', questionIds));
    await remove('answers', 'id', answerIds);
    await remove('questions', 'id', questionIds);
    await remove('direct_messages', 'id', messages.map(m => m.id));
    await remove('direct_conversations', 'id', conversationIds);
    for (const id of present) { ok(await admin.auth.admin.deleteUser(id)); result.deletedUsers++; }
    for (const fixture of manifest.users) {
      const found = await admin.auth.admin.getUserById(fixture.id);
      assert(found.error?.status === 404 && found.error?.code === 'user_not_found', 'Auth deletion not verified');
    }
    for (const [table, column, values] of [
      ['profiles', 'id', ids], ['policy_acceptances', 'user_id', ids], ['questions', 'author_id', ids],
      ['answers', 'author_id', ids], ['direct_messages', 'sender_id', ids],
      ['direct_conversations', 'user_one_id', ids], ['direct_conversations', 'user_two_id', ids],
    ]) assert.equal((await rows(table, column, values)).length, 0, 'Remaining fixture rows');
    result.passed = true;
  } catch { result.failure = 'Cleanup refused or incomplete. Preserve manifest and inspect run-owned records; do not reset the project.'; }
  return result;
}

import { isImportedPost } from './post-presentation';

type ArchiveFeedShape = {
  questions: { id: string; source?: string; answer_count: number; source_comment_count?: number }[];
  answersByQuestionId: Record<string, { id: string; question_id: string; status: string }[]>;
};

/** Public reply totals describe retrievable comments, not an upstream platform's
 * potentially larger total. Preserve that source total separately for provenance.
 * Copies only: the reviewed archive and its ingestion metadata remain unchanged. */
export function normalizeArchiveFeed<T extends ArchiveFeedShape>(feed: T): T {
  const answersByQuestionId = { ...feed.answersByQuestionId };
  const questions = feed.questions.map((question) => {
    if (!isImportedPost(question)) return question;
    const captured = answersByQuestionId[question.id] ?? [];
    // Match thread rendering's last-row-wins deduplication, then exclude records
    // that are not visible replies to this specific question.
    const answers = [...new Map(captured.map((answer) => [answer.id, answer])).values()]
      .filter((answer) => answer.status === 'active' && answer.question_id === question.id);
    answersByQuestionId[question.id] = answers;
    return {
      ...question,
      source_comment_count: question.source_comment_count ?? question.answer_count,
      answer_count: answers.length,
    };
  });
  return { ...feed, questions, answersByQuestionId };
}

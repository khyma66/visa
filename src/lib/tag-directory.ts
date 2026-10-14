import type { Question } from './types';

export type ArchiveTagSummary = { tag: string; count: number; example: string };
export type DirectoryTag = { tag: string; question_count: number; native_count: number; archive_count: number; example_title: string };
export const TAG_DIRECTORY_PAGE_SIZE = 50;

export function summarizeArchiveTags(questions: Pick<Question, 'tags' | 'title' | 'status'>[]): ArchiveTagSummary[] {
  const rows = new Map<string, ArchiveTagSummary>();
  for (const question of questions) {
    if (question.status === 'archived') continue;
    for (const tag of new Set(question.tags)) {
      if (!/^[a-z0-9-]{1,40}$/.test(tag)) continue;
      const row = rows.get(tag) ?? { tag, count: 0, example: question.title.slice(0, 160) };
      row.count++;
      rows.set(tag, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export function directoryPage(rows: DirectoryTag[]): { tags: DirectoryTag[]; hasMore: boolean } {
  return { tags: rows.slice(0, TAG_DIRECTORY_PAGE_SIZE), hasMore: rows.length > TAG_DIRECTORY_PAGE_SIZE };
}

export function archiveDirectoryPage(summary: ArchiveTagSummary[], query: string, sort: string, cursor?: DirectoryTag) {
  const rows: DirectoryTag[] = summary.filter((row) => row.tag.includes(query.trim().toLowerCase().slice(0, 40)))
    .map((row) => ({ tag: row.tag, question_count: row.count, native_count: 0, archive_count: row.count, example_title: row.example }))
    .sort((a, b) => (sort === 'name' ? 0 : b.question_count - a.question_count) || a.tag.localeCompare(b.tag))
    .filter((row) => !cursor || (sort === 'name' ? row.tag > cursor.tag
      : row.question_count < cursor.question_count || (row.question_count === cursor.question_count && row.tag > cursor.tag)));
  return directoryPage(rows);
}

import type { AssistantResult } from './assistant-contract';
import { safeAssistantHref } from './assistant-client';

type ExportTurn = { prompt: string; state: string; result?: AssistantResult };

/** Plain text, explicitly downloaded by the user. No tokens, hidden bodies or server writes. */
export function assistantChatExport(turns: ExportTurn[]): string {
  const sections = ['VisaThreads chat', 'Local copy of this conversation, not automatic account history. Community reports are not verified immigration guidance.'];
  for (const turn of turns.slice(-20)) {
    const result = turn.state === 'complete' ? turn.result : undefined;
    sections.push(`You: ${turn.prompt.slice(0, 1200)}`);
    if (!result) {
      sections.push(`Assistant: ${turn.state === 'pending' ? 'Response in progress (not saved).' : turn.state === 'cancelled' ? 'Stopped.' : 'No answer received.'}`);
      continue;
    }
    const claims = [...result.claims, ...result.disagreements];
    const lines = result.kind === 'posts'
      ? (result.posts ?? []).map(post => `${post.title}\n${post.excerpt}${safeAssistantHref(post.url) ? `\nhttps://visathreads.com${post.url}` : ''}`)
      : claims.map(claim => `${claim.text}${[...new Set(claim.evidence.map(item => item.sourceId))].map(id => {
        const index = result.sources.findIndex(source => source.id === id);
        return index >= 0 ? ` [${index + 1}]` : '';
      }).join('')}`);
    sections.push(`Assistant:\n${lines.concat(result.unanswered).join('\n\n')}`);
    const cited = new Set(claims.flatMap(claim => claim.evidence.map(item => item.sourceId)));
    const links = result.sources.flatMap((source, index) => cited.has(source.id) && safeAssistantHref(source.url)
      ? [`[${index + 1}] ${source.title}\nhttps://visathreads.com${source.url}`] : []);
    if (links.length) sections.push(`Sources:\n${links.join('\n')}`);
    sections.push(`Generated: ${result.generatedAt}${result.coverage.partial ? '\nSelected discussions only; coverage may be incomplete.' : ''}`);
  }
  return sections.join('\n\n') + '\n';
}

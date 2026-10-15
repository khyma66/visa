/** Shared wire types only: never put provider secrets or server imports here. */
export type AssistantMode = 'ask' | 'summary' | 'catchup';
export type AssistantScope = { kind: 'post'; id: string } | { kind: 'community'; id: string } | { kind: 'public' };
export type AssistantRequest = {
  mode: AssistantMode;
  scope: AssistantScope;
  question?: string;
  since?: string;
  until?: string;
  /** Previous user questions only. Assistant text is never trusted as evidence. */
  previousQuestions?: string[];
};
export type AssistantSource = {
  id: string;
  kind: 'question' | 'reply';
  questionId: string;
  communityId: string | null;
  title: string;
  body: string;
  /** Earlier parent text for interpreting a reply, never a new catch-up event. */
  parentContext?: string;
  /** Included in the cache fingerprint even when the parent excerpt is truncated. */
  parentUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  provenance: 'member' | 'archive';
};
export type AssistantEvidence = { sourceId: string; quote: string };
export type AssistantClaim = { text: string; evidence: AssistantEvidence[] };
export type AssistantPostMatch = {
  questionId: string;
  title: string;
  url: string;
  excerpt: string;
  sourceId: string;
  createdAt: string;
};
export type AssistantResult = {
  /** Direct, server-selected search results; no model-generated claims. */
  kind?: 'posts';
  posts?: AssistantPostMatch[];
  status: 'answered' | 'insufficient';
  claims: AssistantClaim[];
  disagreements: AssistantClaim[];
  unanswered: string[];
  sources: AssistantSource[];
  coverage: { sourceCount: number; partial: boolean; since?: string; until?: string };
  generatedAt: string;
  cached: boolean;
  notice: string;
};
export type AssistantAvailability = { posts: boolean; communities: boolean; catchup: boolean };
export type AssistantCorpus = { sources: AssistantSource[]; partial: boolean; since?: string; until?: string };
